"""Teste de fumaça do servidor: sobe, entra com dois clientes e exercita a sala."""
import asyncio, json, sys
import websockets

BASE = "ws://127.0.0.1:8799/ws"
falhas = []


def checa(cond, msg):
    print(("  ok   " if cond else "  FALHA ") + msg)
    if not cond:
        falhas.append(msg)


async def drenar(ws, ate=0.35):
    out = []
    try:
        while True:
            out.append(json.loads(await asyncio.wait_for(ws.recv(), ate)))
    except asyncio.TimeoutError:
        pass
    return out


def ultimo_estado(msgs):
    est = [m["state"] for m in msgs if m["t"] in ("state", "welcome")]
    return est[-1] if est else None


def logs(msgs):
    return [m["entry"]["text"] for m in msgs if m["t"] == "log"]


async def main():
    async with websockets.connect(BASE) as a:
        await a.send(json.dumps({"t": "join", "room": "", "name": "Matheus", "emoji": "🎧"}))
        bem = json.loads(await a.recv())
        checa(bem["t"] == "welcome", "primeiro cliente recebe boas-vindas")
        sala = bem["state"]["room"]
        eu_a = bem["you"]["id"]
        checa(bem["you"]["isOwner"], "quem cria a sala vira o dono")
        checa(len(sala) == 6, f"código da sala tem 6 caracteres ({sala})")
        await drenar(a)

        async with websockets.connect(BASE) as b:
            await b.send(json.dumps({"t": "join", "room": sala, "name": "Ana", "emoji": "🌙"}))
            bemb = json.loads(await b.recv())
            checa(not bemb["you"]["isOwner"], "segundo cliente não é dono")
            checa(len(bemb["state"]["members"]) == 2, "sala mostra duas pessoas")
            ms = await drenar(a)
            checa(any("Ana entrou na sala" in t for t in logs(ms)), "entrada de alguém vai para o registro")

            # --- fila -------------------------------------------------
            await b.send(json.dumps({"t": "add", "track": {
                "videoId": "aaaaaaaaaaa", "title": "Primeira", "artist": "X", "duration": 12}}))
            ms = await drenar(a)
            st = ultimo_estado(ms)
            checa(st["now"] and st["now"]["title"] == "Primeira", "primeira faixa vai direto ao ar")
            checa(st["playing"], "sala começa tocando sozinha")
            checa(any("Ana colocou “Primeira” para tocar" in t for t in logs(ms)),
                  "registro nomeia quem colocou a música")

            await a.send(json.dumps({"t": "add", "track": {
                "videoId": "bbbbbbbbbbb", "title": "Segunda", "artist": "Y", "duration": 200}}))
            ms = await drenar(b)
            st = ultimo_estado(ms)
            checa(len(st["queue"]) == 1 and st["queue"][0]["title"] == "Segunda",
                  "segunda faixa entra na fila")
            checa(any("Matheus adicionou “Segunda” à fila" in t for t in logs(ms)),
                  "registro anota quem adicionou à fila")

            # --- pausa global ----------------------------------------
            await b.send(json.dumps({"t": "pause_all"}))
            ms = await drenar(a)
            st = ultimo_estado(ms)
            checa(st["playing"] is False, "pausa global para a sala inteira")
            checa(any("Ana pausou para todos" in t for t in logs(ms)), "registro anota pausa global")

            pos1 = st["position"]
            await asyncio.sleep(0.8)
            ms = await drenar(a)
            st2 = ultimo_estado(ms) or st
            checa(abs(st2["position"] - pos1) < 0.05, "posição congela enquanto está pausado")

            await a.send(json.dumps({"t": "play_all"}))
            ms = await drenar(b)
            checa(ultimo_estado(ms)["playing"] is True, "retomada global volta a tocar")

            # --- pausa pessoal ---------------------------------------
            await b.send(json.dumps({"t": "detach"}))
            ms = await drenar(a)
            st = ultimo_estado(ms)
            ana = [m for m in st["members"] if m["name"] == "Ana"][0]
            checa(ana["detached"] is True, "pausa pessoal marca só quem pausou")
            checa(st["playing"] is True, "pausa pessoal NÃO para a sala")
            checa(any("Ana pausou só para si" in t for t in logs(ms)), "registro separa pausa pessoal")

            await asyncio.sleep(0.6)
            await b.send(json.dumps({"t": "attach"}))
            ms = await drenar(a)
            st = ultimo_estado(ms)
            ana = [m for m in st["members"] if m["name"] == "Ana"][0]
            checa(ana["detached"] is False, "voltar reconecta a pessoa à sala")
            checa(st["position"] > 0.5, "a sala andou enquanto ela estava fora")

            # --- pular -----------------------------------------------
            await b.send(json.dumps({"t": "skip_all"}))
            ms = await drenar(a)
            st = ultimo_estado(ms)
            checa(st["now"]["title"] == "Segunda", "pular põe a próxima da fila no ar")
            checa(st["position"] < 0.4, "faixa nova começa do zero")
            checa(any("pulou “Primeira” para todos" in t and "Agora: “Segunda”" in t
                      for t in logs(ms)), "registro descreve o pulo por completo")

            # --- permissões ------------------------------------------
            await a.send(json.dumps({"t": "add", "track": {
                "videoId": "ccccccccccc", "title": "Terceira", "duration": 100}}))
            ms = await drenar(b)
            tid = ultimo_estado(ms)["queue"][0]["id"]
            await b.send(json.dumps({"t": "remove", "trackId": tid}))
            ms = await drenar(b)
            erro = [m for m in ms if m["t"] == "error"]
            checa(bool(erro), "quem não adicionou (e não é dono) não consegue remover")

            await a.send(json.dumps({"t": "remove", "trackId": tid}))
            ms = await drenar(a)
            checa(len(ultimo_estado(ms)["queue"]) == 0, "quem adicionou consegue remover")

            # --- renomear com emoji ----------------------------------
            await b.send(json.dumps({"t": "rename", "name": "Aninha", "emoji": "🔥"}))
            ms = await drenar(a)
            st = ultimo_estado(ms)
            checa(any(m["name"] == "Aninha" and m["emoji"] == "🔥" for m in st["members"]),
                  "troca de nome e emoji propaga")
            checa(any("agora se chama 🔥 Aninha" in t for t in logs(ms)), "registro anota a troca de nome")

            # --- chat ------------------------------------------------
            await b.send(json.dumps({"t": "chat", "text": "que música é essa??"}))
            ms = await drenar(a)
            checa(any("Aninha: que música é essa??" in t for t in logs(ms)),
                  "chat entra no registro com o nome de quem falou")

            # --- reação e voto democrático ---------------------------
            await b.send(json.dumps({"t": "react", "emoji": "🔥"}))
            ms = await drenar(a)
            checa(any(m["t"] == "react" and m["emoji"] == "🔥" and "Aninha" in m["who"]
                      for m in ms), "reação chega aos outros com quem reagiu")

            await a.send(json.dumps({"t": "downvote"}))
            ms = await drenar(b)
            st = ultimo_estado(ms)
            checa(st["downvotes"] == 1 and st["voteThreshold"] == 2,
                  "primeiro voto conta e mostra o limite (1/2)")
            checa(any("votou para pular (1/2)" in t for t in logs(ms)),
                  "registro anota o voto")

            await a.send(json.dumps({"t": "downvote"}))
            ms = await drenar(b)
            st = ultimo_estado(ms) or st   # servidor ignora em silêncio: sem estado novo
            checa(st["downvotes"] == 1, "voto repetido da mesma pessoa não conta duas vezes")

            await b.send(json.dumps({"t": "downvote"}))
            ms = await drenar(a)
            st = ultimo_estado(ms)
            checa(st["now"] is None or st["now"]["title"] != "Segunda",
                  "maioria de votos pula a faixa sozinha")
            checa(any("pulada por votação" in t for t in logs(ms)),
                  "registro conta que foi pulada por votação")
            checa(st["downvotes"] == 0, "votos zeram quando a faixa muda")

            # repõe uma faixa no ar para os testes seguintes
            await a.send(json.dumps({"t": "add", "track": {
                "videoId": "ddddddddddd", "title": "Quarta", "artist": "Z", "duration": 200}}))
            await drenar(a); await drenar(b)

            # --- anúncio ---------------------------------------------
            await b.send(json.dumps({"t": "ad", "on": True}))
            ms = await drenar(a)
            st = ultimo_estado(ms)
            ana = [m for m in st["members"] if m["name"] == "Aninha"][0]
            checa(ana["inAd"] is True, "quem está em anúncio aparece marcado para os outros")
            checa(st["playing"] is True, "anúncio de um NÃO pausa a sala")

            await b.send(json.dumps({"t": "ad", "on": False}))
            ms = await drenar(a)
            st = ultimo_estado(ms)
            ana = [m for m in st["members"] if m["name"] == "Aninha"][0]
            checa(ana["inAd"] is False, "fim do anúncio limpa a marca")

            # --- fim natural da faixa --------------------------------
            await a.send(json.dumps({"t": "seek_all", "position": 199.6}))
            await drenar(a)
            ms = await drenar(a, 4.5)
            st = ultimo_estado(ms)
            checa(st is not None and st["now"] is None, "faixa termina sozinha e a fila esvazia")
            checa(any("A fila está vazia" in t for t in logs(ms)), "registro avisa que a fila acabou")

            # --- relógio ---------------------------------------------
            await a.send(json.dumps({"t": "ping", "ts": 123}))
            ms = await drenar(a)
            checa(any(m["t"] == "pong" and m["ts"] == 123 for m in ms), "ping/pong devolve o relógio")

        # b saiu
        ms = await drenar(a, 0.6)
        checa(any("saiu da sala" in t for t in logs(ms)), "saída também vai para o registro")

    # troca de dono
    async with websockets.connect(BASE) as c:
        await c.send(json.dumps({"t": "join", "room": "", "name": "Dono", "emoji": ""}))
        w = json.loads(await c.recv())
        s2 = w["state"]["room"]
        async with websockets.connect(BASE) as d:
            await d.send(json.dumps({"t": "join", "room": s2, "name": "Outro", "emoji": ""}))
            await drenar(d)
            await c.close()
            ms = await drenar(d, 0.8)
            checa(any("agora é o dono da sala" in t for t in logs(ms)),
                  "dono sai e a coroa passa para quem ficou")

    print()
    if falhas:
        print(f"{len(falhas)} falha(s):")
        for f in falhas:
            print("  -", f)
        sys.exit(1)
    print("Tudo passou.")


asyncio.run(main())
