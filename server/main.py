"""
JAMigos — servidor de salas sincronizadas para YouTube Music.

Roda tudo em memória: sem banco de dados, sem cadastro.
Uma sala morre sozinha alguns minutos depois que a última pessoa sai.
"""

import asyncio
import io
import json
import os
import random
import secrets
import time
import zipfile
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, Response

ROOT = Path(__file__).resolve().parent
EXT_DIR = ROOT.parent / "extension"
PAGES_DIR = ROOT / "pages"

# Alfabeto sem caracteres que se confundem quando alguém dita o código em voz alta.
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

ROOM_TTL_SECONDS = 15 * 60      # sala vazia é apagada depois disso
TICK_SECONDS = 1.0              # frequência do relógio autoritativo
BEACON_SECONDS = 5.0            # de quanto em quanto tempo mandamos estado completo
LOG_LIMIT = 300


import re as _re
_HEX = _re.compile(r"^#[0-9A-Fa-f]{6}$")


def cor_valida(v) -> str:
    v = (v or "").strip()
    return v if _HEX.match(v) else ""


def now_ms() -> int:
    return int(time.time() * 1000)


def new_code() -> str:
    return "".join(random.choice(CODE_ALPHABET) for _ in range(6))


def new_id() -> str:
    return secrets.token_urlsafe(9)


# --------------------------------------------------------------------------
# Modelo
# --------------------------------------------------------------------------

class Member:
    def __init__(self, mid: str, name: str, emoji: str, ws: WebSocket,
                 color: str = ""):
        self.id = mid
        self.name = name
        self.emoji = emoji
        self.color = color or "#FF4FA0"
        self.ws = ws
        self.detached = False       # pausou só pra si
        self.in_ad = False          # assistindo um anúncio agora
        self.ready = False          # já destravou o autoplay
        self.color = "#FF4FA0"      # cor do perfil na sala
        self.react_times: list = [] # controle de ritmo das reações

    def public(self, owner_id: str) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "emoji": self.emoji,
            "isOwner": self.id == owner_id,
            "detached": self.detached,
            "inAd": self.in_ad,
            "color": self.color,
        }


class Track:
    def __init__(self, video_id: str, title: str, artist: str, duration: float,
                 added_by: str, added_by_name: str):
        self.id = new_id()
        self.video_id = video_id
        self.title = title or "Faixa sem título"
        self.artist = artist or ""
        self.duration = float(duration or 0)
        self.added_by = added_by
        self.added_by_name = added_by_name

    def public(self) -> dict:
        return {
            "id": self.id,
            "videoId": self.video_id,
            "title": self.title,
            "artist": self.artist,
            "duration": self.duration,
            "addedBy": self.added_by,
            "addedByName": self.added_by_name,
        }


class Room:
    def __init__(self, code: str):
        self.code = code
        self.owner_id: Optional[str] = None
        self.members: Dict[str, Member] = {}
        self.queue: List[Track] = []
        self.now: Optional[Track] = None
        self.playing = False
        self._pos_base = 0.0          # posição em segundos no momento _pos_at
        self._pos_at = now_ms()
        self.downvotes: set = set()   # quem votou para pular a faixa atual
        # As fotos de perfil NÃO entram no estado periódico da sala: são
        # pesadas e mudam raramente. Vão uma vez, na entrada, e depois só
        # quando alguém troca a sua.
        self.avatars: Dict[str, str] = {}
        self.log: List[dict] = []
        self.empty_since: Optional[float] = time.time()
        self._advance_lock = 0.0      # evita pular duas faixas ao mesmo tempo

    # ---- posição -----------------------------------------------------

    def position(self) -> float:
        if not self.now:
            return 0.0
        if not self.playing:
            return self._pos_base
        return self._pos_base + (now_ms() - self._pos_at) / 1000.0

    def set_position(self, seconds: float):
        self._pos_base = max(0.0, seconds)
        self._pos_at = now_ms()

    # ---- registro ----------------------------------------------------

    def add_log(self, kind: str, text: str, who: Optional[str] = None,
                track: Optional[dict] = None) -> dict:
        entry = {"id": new_id(), "ts": now_ms(), "kind": kind, "text": text, "who": who}
        if track:
            entry["track"] = track
        if who and who in self.members:
            entry["color"] = self.members[who].color
        self.log.append(entry)
        if len(self.log) > LOG_LIMIT:
            self.log = self.log[-LOG_LIMIT:]
        return entry

    # ---- estado ------------------------------------------------------

    def vote_threshold(self) -> int:
        """3 votos pulam a música. Em salas com menos de 3 pessoas ouvindo,
        vale o total de ouvintes (senão uma dupla nunca conseguiria pular)."""
        ativos = [m for m in self.members.values() if not m.detached]
        return min(3, max(1, len(ativos)))

    def state(self) -> dict:
        return {
            "room": self.code,
            "ownerId": self.owner_id,
            "members": [m.public(self.owner_id) for m in self.members.values()],
            "queue": [t.public() for t in self.queue],
            "now": self.now.public() if self.now else None,
            "playing": self.playing,
            "position": round(self.position(), 3),
            "downvotes": len(self.downvotes & set(self.members.keys())),
            "voteThreshold": self.vote_threshold(),
            "serverTime": now_ms(),
        }

    # ---- fila --------------------------------------------------------

    def advance(self) -> Optional[Track]:
        """Puxa a próxima faixa da fila para o ar. Devolve a faixa nova (ou None)."""
        self.downvotes.clear()
        if self.queue:
            self.now = self.queue.pop(0)
            self.set_position(0.0)
            self.playing = True
        else:
            self.now = None
            self.set_position(0.0)
            self.playing = False
        return self.now

    # ---- transmissão -------------------------------------------------

    async def send(self, member: Member, payload: dict):
        try:
            await member.ws.send_text(json.dumps(payload))
        except Exception:
            pass

    async def broadcast(self, payload: dict, skip: Optional[str] = None):
        dead = []
        data = json.dumps(payload)
        for m in list(self.members.values()):
            if skip and m.id == skip:
                continue
            try:
                await m.ws.send_text(data)
            except Exception:
                dead.append(m.id)
        for mid in dead:
            self.members.pop(mid, None)

    async def push_state(self):
        await self.broadcast({"t": "state", "state": self.state()})

    async def push_log(self, entry: dict):
        await self.broadcast({"t": "log", "entry": entry})

    async def announce(self, kind: str, text: str, who: Optional[str] = None,
                       track: Optional[dict] = None):
        await self.push_log(self.add_log(kind, text, who, track))


ROOMS: Dict[str, Room] = {}

# --------------------------------------------------------------------------
# Persistência: um JSON no disco, salvo a cada 30 s.
# Se o servidor cair no meio da festa, a sala volta com fila, faixa,
# posição e registro — pausada, esperando alguém apertar o play.
# --------------------------------------------------------------------------

DATA_FILE = Path(os.environ.get("OJ_DATA", str(ROOT / "salas.json")))
SAVE_EVERY_SECONDS = 30


def _track_dict(t: Track) -> dict:
    return t.public()


def _track_from(d: dict) -> Track:
    t = Track(d.get("videoId", ""), d.get("title", ""), d.get("artist", ""),
              d.get("duration", 0), d.get("addedBy", ""), d.get("addedByName", ""))
    t.id = d.get("id") or t.id
    return t


def salvar_salas():
    dados = {}
    for code, r in ROOMS.items():
        dados[code] = {
            "queue": [_track_dict(t) for t in r.queue],
            "now": _track_dict(r.now) if r.now else None,
            "playing": r.playing,
            "position": round(r.position(), 3),
            "log": r.log[-LOG_LIMIT:],
        }
    try:
        tmp = DATA_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, DATA_FILE)
    except OSError:
        pass  # disco só de leitura ou cheio: a festa continua, só sem seguro


def carregar_salas():
    if not DATA_FILE.exists():
        return
    try:
        dados = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    for code, d in dados.items():
        room = Room(code)
        room.queue = [_track_from(x) for x in d.get("queue", [])]
        room.now = _track_from(d["now"]) if d.get("now") else None
        room.playing = False                      # volta pausada, por segurança
        room.set_position(float(d.get("position", 0)))
        room.log = d.get("log", [])
        room.add_log("auto", "O servidor reiniciou. A sala voltou pausada, no ponto em que estava.")
        room.empty_since = time.time()
        ROOMS[code] = room


# --------------------------------------------------------------------------
# App
# --------------------------------------------------------------------------

SERVER_TOKEN = os.environ.get("OJ_TOKEN", "").strip()

def versao_da_extensao() -> str:
    try:
        return json.loads((EXT_DIR / "manifest.json").read_text())["version"]
    except Exception:
        return ""

EXT_VERSION = versao_da_extensao()

app = FastAPI(title="JAMigos")


@app.on_event("startup")
async def _startup():
    carregar_salas()
    print(f"[JAMigos] versão {EXT_VERSION} no ar | "
          f"salas restauradas: {len(ROOMS)} | "
          f"acesso {'fechado por senha' if SERVER_TOKEN else 'aberto'} | "
          f"dados em {DATA_FILE}", flush=True)
    asyncio.create_task(clock_loop())


@app.on_event("shutdown")
async def _shutdown():
    salvar_salas()


async def clock_loop():
    """Relógio autoritativo: avança faixas que terminaram e reenvia o estado."""
    last_beacon = 0.0
    last_save = time.time()
    while True:
        await asyncio.sleep(TICK_SECONDS)
        tnow = time.time()
        beacon = (tnow - last_beacon) >= BEACON_SECONDS
        if beacon:
            last_beacon = tnow
        if (tnow - last_save) >= SAVE_EVERY_SECONDS:
            last_save = tnow
            salvar_salas()

        for code, room in list(ROOMS.items()):
            # limpeza de salas vazias
            if not room.members:
                if room.empty_since and (tnow - room.empty_since) > ROOM_TTL_SECONDS:
                    ROOMS.pop(code, None)
                continue

            # fim natural da faixa
            if (room.now and room.playing and room.now.duration > 0
                    and room.position() >= room.now.duration - 0.35
                    and tnow > room._advance_lock):
                room._advance_lock = tnow + 2.0
                terminou = room.now.title
                acabou = room.now.public()
                nova = room.advance()
                if nova:
                    room.add_log("auto", f"Acabou “{terminou}”. Agora: “{nova.title}”.", track=acabou)
                else:
                    room.add_log("auto", f"Acabou “{terminou}”. A fila está vazia.", track=acabou)
                await room.push_state()
                await room.push_log(room.log[-1])
                continue

            if beacon:
                await room.push_state()


# --------------------------------------------------------------------------
# WebSocket
# --------------------------------------------------------------------------

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    room: Optional[Room] = None
    me: Optional[Member] = None

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            t = msg.get("t")

            # -- ping é respondido sempre, até antes de entrar --------
            if t == "ping":
                await ws.send_text(json.dumps(
                    {"t": "pong", "ts": msg.get("ts"), "serverTime": now_ms()}))
                continue

            # -- entrar ----------------------------------------------
            if t == "join":
                if SERVER_TOKEN and (msg.get("token") or "") != SERVER_TOKEN:
                    await ws.send_text(json.dumps({
                        "t": "error",
                        "message": "Este servidor é fechado. Baixe a extensão de novo pela página dele."}))
                    continue
                code = (msg.get("room") or "").strip().upper()
                name = (msg.get("name") or "Convidado").strip()[:24] or "Convidado"
                emoji = (msg.get("emoji") or "")[:4]
                cor = (msg.get("color") or "")[:9]

                if not code:
                    code = new_code()
                    while code in ROOMS:
                        code = new_code()
                room = ROOMS.get(code)
                if room is None:
                    room = Room(code)
                    ROOMS[code] = room

                me = Member(new_id(), name, emoji, ws, cor_valida(msg.get("color")))
                if cor.startswith("#"):
                    me.color = cor
                if room.owner_id is None or room.owner_id not in room.members:
                    room.owner_id = me.id
                room.members[me.id] = me
                room.empty_since = None

                await ws.send_text(json.dumps({
                    "t": "welcome",
                    "you": {"id": me.id, "isOwner": me.id == room.owner_id},
                    "state": room.state(),
                    "log": room.log[-80:],
                    "serverTime": now_ms(),
                    "latestVersion": EXT_VERSION,
                    "avatars": room.avatars,
                }))
                foto = msg.get("avatar") or ""
                if foto.startswith("data:image/") and len(foto) <= 14000:
                    room.avatars[me.id] = foto
                    await room.broadcast({"t": "avatar", "id": me.id, "data": foto})
                await room.announce("join", f"{emoji} {name} entrou na sala.".strip(), me.id)
                await room.push_state()
                continue

            if room is None or me is None:
                continue

            # -- identidade ------------------------------------------
            if t == "rename":
                antigo = f"{me.emoji} {me.name}".strip()
                me.name = (msg.get("name") or me.name).strip()[:24] or me.name
                me.emoji = (msg.get("emoji") or "")[:4]
                me.color = cor_valida(msg.get("color")) or me.color
                cor = (msg.get("color") or "")[:9]
                if cor.startswith("#"):
                    me.color = cor
                novo = f"{me.emoji} {me.name}".strip()
                if antigo != novo:
                    await room.announce("rename", f"{antigo} agora se chama {novo}.", me.id)
                await room.push_state()

            # -- fila ------------------------------------------------
            elif t == "add":
                tr = msg.get("track") or {}
                vid = (tr.get("videoId") or "").strip()
                if not vid:
                    continue
                track = Track(vid, tr.get("title", ""), tr.get("artist", ""),
                              tr.get("duration", 0), me.id, f"{me.emoji} {me.name}".strip())
                if room.now is None and not room.queue:
                    room.now = track
                    room.set_position(0.0)
                    room.playing = True
                    await room.announce(
                        "add", f"{me.emoji} {me.name} colocou “{track.title}” para tocar.".strip(),
                        me.id, track.public())
                else:
                    room.queue.append(track)
                    await room.announce(
                        "add", f"{me.emoji} {me.name} adicionou “{track.title}” à fila.".strip(),
                        me.id, track.public())
                await room.broadcast({
                    "t": "added_flash",
                    "who": f"{me.emoji} {me.name}".strip(),
                    "title": track.title,
                    "color": me.color,
                })
                await room.push_state()

            elif t == "remove":
                tid = msg.get("trackId")
                alvo = next((x for x in room.queue if x.id == tid), None)
                if not alvo:
                    continue
                if alvo.added_by != me.id and me.id != room.owner_id:
                    await room.send(me, {"t": "error",
                                         "message": "Só quem adicionou a faixa (ou o dono da sala) pode tirá-la."})
                    continue
                room.queue.remove(alvo)
                await room.announce(
                    "remove", f"{me.emoji} {me.name} tirou “{alvo.title}” da fila.".strip(), me.id)
                await room.push_state()

            elif t == "clear":
                if me.id != room.owner_id:
                    await room.send(me, {"t": "error", "message": "Só o dono da sala pode limpar a fila."})
                    continue
                if room.queue:
                    room.queue.clear()
                    await room.announce(
                        "remove", f"{me.emoji} {me.name} limpou a fila.".strip(), me.id)
                    await room.push_state()

            elif t == "move":
                tid, delta = msg.get("trackId"), int(msg.get("delta", 0))
                idx = next((i for i, x in enumerate(room.queue) if x.id == tid), None)
                if idx is None or delta == 0:
                    continue
                alvo = min(max(idx + delta, 0), len(room.queue) - 1)
                room.queue.insert(alvo, room.queue.pop(idx))
                await room.push_state()

            # -- controles globais -----------------------------------
            elif t == "pause_all":
                if room.playing:
                    room.set_position(room.position())
                    room.playing = False
                    await room.announce(
                        "pause_all", f"{me.emoji} {me.name} pausou para todos.".strip(), me.id)
                    await room.push_state()

            elif t == "play_all":
                if not room.playing and room.now:
                    room.set_position(room.position())
                    room.playing = True
                    await room.announce(
                        "play_all", f"{me.emoji} {me.name} retomou para todos.".strip(), me.id)
                    await room.push_state()

            elif t == "skip_all":
                if not room.now:
                    continue
                anterior = room.now.title
                pulada = room.now.public()
                room._advance_lock = time.time() + 2.0
                nova = room.advance()
                if nova:
                    txt = f"{me.emoji} {me.name} pulou “{anterior}” para todos. Agora: “{nova.title}”."
                else:
                    txt = f"{me.emoji} {me.name} pulou “{anterior}” para todos. A fila acabou."
                await room.announce("skip_all", txt.strip(), me.id, pulada)
                await room.push_state()

            elif t == "seek_all":
                if not room.now:
                    continue
                pos = float(msg.get("position", 0))
                room.set_position(pos)
                mm, ss = divmod(int(pos), 60)
                await room.announce(
                    "seek", f"{me.emoji} {me.name} moveu a faixa para {mm}:{ss:02d}.".strip(), me.id)
                await room.push_state()

            # -- pausa pessoal ---------------------------------------
            elif t == "detach":
                if not me.detached:
                    me.detached = True
                    await room.announce(
                        "detach", f"{me.emoji} {me.name} pausou só para si.".strip(), me.id)
                    await room.push_state()

            elif t == "attach":
                if me.detached:
                    me.detached = False
                    await room.announce(
                        "attach", f"{me.emoji} {me.name} voltou para o som da sala.".strip(), me.id)
                    await room.push_state()

            elif t == "avatar":
                foto = msg.get("data") or ""
                if not foto:
                    room.avatars.pop(me.id, None)
                    await room.broadcast({"t": "avatar", "id": me.id, "data": ""})
                elif foto.startswith("data:image/") and len(foto) <= 14000:
                    room.avatars[me.id] = foto
                    await room.broadcast({"t": "avatar", "id": me.id, "data": foto})

            elif t == "ready":
                me.ready = True

            # -- chat ------------------------------------------------
            elif t == "chat":
                texto = (msg.get("text") or "").strip()[:280]
                if texto:
                    await room.announce("chat", f"{me.emoji} {me.name}: {texto}".strip(), me.id)

            # -- reações ---------------------------------------------
            elif t == "react":
                emoji = (msg.get("emoji") or "").strip()[:4]
                agora = time.time()
                me.react_times = [x for x in me.react_times if agora - x < 1.0]
                if len(me.react_times) >= 3:
                    continue          # metralhadora de emoji, não
                me.react_times.append(agora)
                if emoji:
                    await room.broadcast({
                        "t": "react", "emoji": emoji,
                        "who": f"{me.emoji} {me.name}".strip(),
                        "whoId": me.id, "color": me.color
                    })

            elif t == "downvote":
                if not room.now or me.id in room.downvotes:
                    continue
                room.downvotes.add(me.id)
                votos = len(room.downvotes & set(room.members.keys()))
                limite = room.vote_threshold()
                if votos >= limite:
                    anterior = room.now.title
                    pulada = room.now.public()
                    room._advance_lock = time.time() + 2.0
                    nova = room.advance()
                    if nova:
                        txt = f"“{anterior}” foi pulada por votação ({votos} votos 👎). Agora: “{nova.title}”."
                    else:
                        txt = f"“{anterior}” foi pulada por votação ({votos} votos 👎). A fila acabou."
                    await room.announce("skip_all", txt, None, pulada)
                else:
                    await room.announce(
                        "vote",
                        f"{me.emoji} {me.name} votou para pular ({votos}/{limite}).".strip(), me.id)
                await room.push_state()

            # -- anúncio ---------------------------------------------
            elif t == "ad":
                ligado = bool(msg.get("on"))
                if me.in_ad != ligado:
                    me.in_ad = ligado
                    await room.push_state()

            # -- corrigir a duração real da faixa --------------------
            # Faixas adicionadas pelo botão ＋ podem vir sem duração. Quem já
            # está tocando sabe o valor certo e conta para o servidor, para o
            # relógio dele poder avançar sozinho.
            elif t == "fix_duration":
                dur = float(msg.get("duration") or 0)
                if (room.now and msg.get("videoId") == room.now.video_id
                        and dur > 1 and abs(room.now.duration - dur) > 2):
                    room.now.duration = dur
                    await room.push_state()

            # -- faixa terminou no cliente ---------------------------
            # O relógio do servidor é quem manda. Isto aqui é só uma rede de
            # segurança para faixas de duração desconhecida — e só é aceito se
            # a faixa realmente tocou. Sem isso, o erro de UM player
            # (vídeo indisponível, queda de rede) pulava a música de TODOS,
            # em cascata.
            elif t == "ended":
                if not room.now or msg.get("videoId") != room.now.video_id:
                    continue
                pos = room.position()
                dur = room.now.duration
                if dur > 0:
                    plausivel = pos >= dur - 8          # está mesmo no fim
                else:
                    plausivel = pos >= 15               # tocou tempo suficiente
                if not plausivel:
                    continue
                if (room.now and msg.get("videoId") == room.now.video_id
                        and time.time() > room._advance_lock):
                    room._advance_lock = time.time() + 2.0
                    terminou = room.now.title
                    acabou = room.now.public()
                    nova = room.advance()
                    if nova:
                        await room.announce("auto", f"Acabou “{terminou}”. Agora: “{nova.title}”.", track=acabou)
                    else:
                        await room.announce("auto", f"Acabou “{terminou}”. A fila está vazia.", track=acabou)
                    await room.push_state()

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if room and me:
            room.members.pop(me.id, None)
            room.avatars.pop(me.id, None)
            await room.announce("leave", f"{me.emoji} {me.name} saiu da sala.".strip(), me.id)
            if room.owner_id == me.id and room.members:
                novo_dono = next(iter(room.members.values()))
                room.owner_id = novo_dono.id
                await room.announce(
                    "owner", f"{novo_dono.emoji} {novo_dono.name} agora é o dono da sala.".strip())
            if not room.members:
                room.empty_since = time.time()
            await room.push_state()


# --------------------------------------------------------------------------
# Páginas + download
# --------------------------------------------------------------------------

def public_origin(request: Request, override: Optional[str] = None) -> str:
    """Atrás de proxies (Replit, Render...), os cabeçalhos podem vir sem a porta
    que o navegador realmente usa. Por isso a página envia o endereço exato da
    barra do navegador em ?o=, que tem prioridade aqui — depois de validado."""
    if override:
        from urllib.parse import urlparse
        u = urlparse(override.strip())
        if u.scheme in ("http", "https") and u.netloc and len(u.netloc) < 260:
            return f"{u.scheme}://{u.netloc}"
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or "localhost:8787"
    return f"{proto}://{host}"


def ws_origin(origin: str) -> str:
    return origin.replace("https://", "wss://").replace("http://", "ws://") + "/ws"


def build_zip(request: Request, override: Optional[str] = None) -> bytes:
    """Empacota a extensão já apontando para este servidor."""
    origin = public_origin(request, override)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(EXT_DIR.rglob("*")):
            if path.is_dir() or "__pycache__" in path.parts:
                continue
            rel = path.relative_to(EXT_DIR).as_posix()
            data = path.read_bytes()
            if rel.endswith((".js", ".json", ".html", ".css")):
                text = data.decode("utf-8")
                text = text.replace("__WS_URL__", ws_origin(origin))
                text = text.replace("__SERVER_ORIGIN__", origin)
                text = text.replace("__TOKEN__", SERVER_TOKEN)
                if rel == "manifest.json":
                    manifesto = json.loads(text)
                    permissoes = manifesto.get("host_permissions", [])
                    alvo = origin.rstrip("/") + "/*"
                    if alvo not in permissoes:
                        permissoes.append(alvo)
                    manifesto["host_permissions"] = permissoes
                    text = json.dumps(manifesto, indent=2, ensure_ascii=False)
                data = text.encode("utf-8")
            z.writestr(rel, data)
    return buf.getvalue()


@app.get("/dl/jamigos.zip")
@app.get("/dl/ouvir-junto.zip")           # apelido antigo, por compatibilidade
async def download(request: Request, o: Optional[str] = None):
    return Response(
        content=build_zip(request, o),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="jamigos.zip"'},
    )


@app.get("/api/room/{code}")
async def room_info(code: str):
    room = ROOMS.get(code.upper())
    if not room:
        return JSONResponse({"exists": False}, status_code=404)
    return {"exists": True, "members": len(room.members),
            "now": room.now.public() if room.now else None}


def render_page(request: Request, code: str = "") -> str:
    html = (PAGES_DIR / "index.html").read_text(encoding="utf-8")
    return (html
            .replace("__SERVER_ORIGIN__", public_origin(request))
            .replace("__ROOM_CODE__", code.upper()))


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return render_page(request)


@app.get("/r/{code}", response_class=HTMLResponse)
async def room_page(request: Request, code: str):
    return render_page(request, code)


@app.get("/privacy", response_class=HTMLResponse)
async def privacy():
    return (PAGES_DIR / "privacy.html").read_text(encoding="utf-8")


BOOT_TIME = time.time()


@app.get("/health")
async def health():
    """Endpoint de monitoramento. Qualquer serviço externo (UptimeRobot e
    similares) pode bater aqui de minuto em minuto e avisar se cair."""
    return {
        "ok": True,
        "version": EXT_VERSION,
        "uptime_s": int(time.time() - BOOT_TIME),
        "rooms": len(ROOMS),
        "listeners": sum(len(r.members) for r in ROOMS.values()),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8787)))
