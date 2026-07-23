/* Ouvir Junto — painel e sincronização, dentro do YouTube Music. */

(() => {
  if (window.__ouvirJuntoCarregado) return;
  window.__ouvirJuntoCarregado = true;

  // =================================================================
  // Estado
  // =================================================================

  const S = {
    entrei: false,
    eu: null,              // { id, isOwner }
    sala: null,            // estado completo vindo do servidor
    registro: [],
    desligado: false,      // pausei só para mim
    liberado: false,       // autoplay já destravado por um clique
    offset: 0,             // relógio do servidor menos o meu
    aba: "fila",
    conexao: "parado",
    emAnuncio: false,
    rascunhoChat: "",
    player: { videoId: "", time: 0, duration: 0, state: -1 },
    aberto: true,
    // preferências locais (só suas, guardadas neste navegador)
    cor: "#FF4FA0",
    verReacoes: true,
    verAvisos: true,
    largura: 372,
    topo: 72
  };

  const CORES = ["#FF4FA0","#8B5CF6","#C6F53F","#38BDF8","#FB923C",
                 "#F43F5E","#2DD4BF","#FACC15","#A78BFA","#4ADE80"];

  const EMOJIS = ["🎧","🎸","🎹","🥁","🎤","🎺","🪩","🔊","🌙","☀️","🔥","🌊",
                  "🍀","🌵","🐈","🐙","🦊","🐝","☕","🍕","🍺","🧊","⚡","💤",
                  "😎","🤠","👽","🤖","💀","👑","🫠","🙃"];

  let porta = null;
  let raiz = null, sombra = null;
  const pendentes = new Map();
  let seqReq = 0;

  // =================================================================
  // Utilidades
  // =================================================================

  const rel = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const m = Math.floor(s / 60), r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  };

  const hora = (ts) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  };

  function h(tag, props = {}, filhos = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, "");
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const f of [].concat(filhos)) {
      if (f) el.appendChild(typeof f === "string" ? document.createTextNode(f) : f);
    }
    return el;
  }

  function idDoLink(txt) {
    const m = /(?:v=|youtu\.be\/|\/watch\?.*v=)([A-Za-z0-9_-]{11})/.exec(txt || "");
    if (m) return m[1];
    if (/^[A-Za-z0-9_-]{11}$/.test((txt || "").trim())) return txt.trim();
    return null;
  }

  function codigoDaURL() {
    try {
      const u = new URL(location.href);
      const q = u.searchParams.get("oj");
      if (q) return q.toUpperCase();
      const m = /[#&]oj=([A-Za-z0-9]{4,10})/.exec(location.hash || "");
      if (m) return m[1].toUpperCase();
    } catch (_) {}
    return "";
  }
  const CODIGO_CONVITE = codigoDaURL();

  // =================================================================
  // Ponte com a página (player)
  // =================================================================

  const paraPagina = (payload) => window.postMessage({ __oj: "c2p", ...payload }, "*");

  function pedir(cmd, extra = {}) {
    const reqId = ++seqReq;
    return new Promise((resolve) => {
      pendentes.set(reqId, resolve);
      setTimeout(() => {
        if (pendentes.delete(reqId)) resolve(null);
      }, 8000);
      paraPagina({ cmd, reqId, ...extra });
    });
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__oj !== "p2c") return;

    if (d.ev === "tick") {
      const antes = S.emAnuncio;
      S.emAnuncio = !!d.ad;

      if (antes !== S.emAnuncio && S.entrei) {
        enviar({ t: "ad", on: S.emAnuncio });
        if (S.emAnuncio) {
          torrada("Anúncio no seu YouTube Music. A sala segue — você volta sozinho no ponto certo.", true);
        } else if (!S.desligado && S.sala?.now) {
          // Anúncio acabou: em vez de retomar de onde parou (atrasado),
          // salta direto para o segundo em que a sala está agora.
          const alvo = posicaoAlvo();
          if (S.player.videoId === S.sala.now.videoId) {
            paraPagina({ cmd: "seek", to: alvo });
            if (S.sala.playing) paraPagina({ cmd: "play" });
          } else {
            paraPagina({ cmd: "load", videoId: S.sala.now.videoId, at: alvo, play: S.sala.playing });
          }
        }
      }

      if (!S.emAnuncio) {
        S.player = {
          videoId: d.track?.videoId || "",
          time: d.time || 0,
          duration: d.duration || 0,
          state: d.state
        };
        // A faixa pode ter entrado na fila sem duração (botão ＋). Quem está
        // tocando sabe o valor certo — conta para o servidor uma vez só.
        const n = S.sala?.now;
        if (n && S.player.videoId === n.videoId && S.player.duration > 1 &&
            Math.abs((n.duration || 0) - S.player.duration) > 2 &&
            S.durAvisada !== n.videoId) {
          S.durAvisada = n.videoId;
          enviar({ t: "fix_duration", videoId: n.videoId, duration: S.player.duration });
        }
        pintarMostrador();
      }
    } else if (d.ev === "ended") {
      // Só avisa se for a faixa da sala, se ela realmente tocou e se eu não
      // estava fora do ar. Erro de carregamento não vira pulo para todos.
      const n = S.sala?.now;
      const tocou = S.player.time > 5 || (n?.duration > 0 && S.player.time >= n.duration - 8);
      if (S.entrei && !S.desligado && !S.emAnuncio && n && d.videoId === n.videoId && tocou) {
        enviar({ t: "ended", videoId: d.videoId });
      }
    } else if (d.ev === "current") {
      const f = pendentes.get(d.reqId);
      if (f) { pendentes.delete(d.reqId); f(d.track); }
    }
  });

  (function injetar() {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("inject.js");
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  })();

  // =================================================================
  // Ponte com o service worker (WebSocket)
  // =================================================================

  function abrirPorta() {
    porta = chrome.runtime.connect({ name: "ouvir-junto" });
    porta.onMessage.addListener(receber);
    porta.onDisconnect.addListener(() => {
      porta = null;
      setTimeout(abrirPorta, 1200);
    });
  }

  const enviar = (payload) => porta?.postMessage({ t: "send", payload });

  function receber(msg) {
    if (msg.t === "status") {
      S.conexao = msg.status;
      if (msg.status === "aberto") medirRelogio();
      // Caiu a conexão: NÃO joga a pessoa para fora da sala. O service worker
      // reconecta sozinho e refaz a entrada; aqui só mostramos o aviso.
      if (msg.status !== "aberto" && S.entrei) {
        paraPagina({ cmd: "pause" });
      }
      pintarTudo();
      return;
    }
    if (msg.t !== "msg") return;
    const p = msg.payload;

    if (p.t === "welcome") {
      S.entrei = true;
      S.versaoNova = !!(p.latestVersion && p.latestVersion !== OJ_CONFIG.VERSION);
      document.documentElement.classList.add("oj-na-sala");
      chrome.storage.local.set({ ojSala: p.state.room });
      S.eu = p.you;
      S.sala = p.state;
      S.registro = p.log || [];
      S.desligado = false;
      pintarTudo();
    } else if (p.t === "state") {
      S.sala = p.state;
      pintarTudo();
      pintarPessoas();
    } else if (p.t === "log") {
      S.registro.push(p.entry);
      if (S.registro.length > 300) S.registro.shift();
      pintarRegistro();
    } else if (p.t === "react") {
      flutuar(p.emoji, p.who, p.color);
    } else if (p.t === "added_flash") {
      avisoNaTela(`🎶 ${p.who} adicionou “${p.title}”`);
    } else if (p.t === "pong") {
      const ida = Date.now() - p.ts;
      S.offset = p.serverTime - (p.ts + ida / 2);
    } else if (p.t === "error") {
      torrada(p.message);
    }
  }

  function medirRelogio() {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => enviar({ t: "ping", ts: Date.now() }), i * 350);
    }
  }
  setInterval(() => { if (S.entrei) enviar({ t: "ping", ts: Date.now() }); }, 20000);

  // =================================================================
  // Sincronização
  // =================================================================

  function posicaoAlvo() {
    const s = S.sala;
    if (!s?.now) return 0;
    if (!s.playing) return s.position;
    const agora = Date.now() + S.offset;
    return s.position + (agora - s.serverTime) / 1000;
  }

  setInterval(() => {
    if (!S.entrei || !S.sala || !S.liberado) return;

    const s = S.sala;

    if (S.desligado) return;                 // a sala segue sem mim, de propósito
    if (S.emAnuncio) return;                 // anúncio manda no player; ao acabar, a gente realinha
    if (S.player.state === 3) return;        // carregando: não brigar com o player

    if (!s.now) {
      if (S.player.state === 1) paraPagina({ cmd: "pause" });
      return;
    }

    const alvo = posicaoAlvo();

    if (S.player.videoId !== s.now.videoId) {
      paraPagina({ cmd: "load", videoId: s.now.videoId, at: alvo, play: s.playing });
      return;
    }
    if (s.playing && S.player.state !== 1) { paraPagina({ cmd: "play" }); return; }
    if (!s.playing && S.player.state === 1) { paraPagina({ cmd: "pause" }); return; }

    if (s.playing && Math.abs(S.player.time - alvo) > 1.8) {
      paraPagina({ cmd: "seek", to: alvo });
    }
  }, 1500);

  // =================================================================
  // Ações
  // =================================================================

  async function entrar(codigo, nomeSalvo, emojiSalvo) {
    const nome = nomeSalvo || (sombra.getElementById("campoNome")?.value || "").trim() || "Convidado";
    const emoji = emojiSalvo || sombra.getElementById("btEmoji")?.textContent?.trim() || "🎧";
    await chrome.storage.local.set({ ojNome: nome, ojEmoji: emoji });
    S.liberado = true;                        // este clique é o gesto que destrava o áudio
    porta?.postMessage({
      t: "connect",
      wsUrl: OJ_CONFIG.WS_URL,
      join: { room: (codigo || "").toUpperCase(), name: nome, emoji,
              color: S.cor, token: OJ_CONFIG.TOKEN || "" }
    });
  }

  function sair() {
    chrome.storage.local.remove("ojSala");
    porta?.postMessage({ t: "disconnect" });
    document.documentElement.classList.remove("oj-na-sala");
    S.entrei = false; S.sala = null; S.eu = null; S.registro = [];
    paraPagina({ cmd: "pause" });
    pintarTudo();
  }

  function desligarDeMim() {
    S.desligado = true;
    paraPagina({ cmd: "pause" });
    enviar({ t: "detach" });
    pintarTudo();
  }

  function voltarProSom() {
    S.desligado = false;
    S.liberado = true;
    enviar({ t: "attach" });
    const s = S.sala;
    if (s?.now) {
      paraPagina({ cmd: "load", videoId: s.now.videoId, at: posicaoAlvo(), play: s.playing });
    }
    pintarTudo();
  }

  async function adicionarAtual() {
    const f = await pedir("current");
    if (!f?.videoId) return torrada("Não achei nenhuma faixa tocando aqui.");
    enviar({ t: "add", track: f });
    torrada(`“${f.title}” foi para a fila.`, true);
  }

  function adicionar(faixa) {
    enviar({ t: "add", track: faixa });
  }

  function copiarTexto(txt) {
    // clipboard API pode ser bloqueada dentro do YouTube Music;
    // o caminho antigo (textarea + execCommand) funciona sempre.
    return navigator.clipboard?.writeText(txt).catch(() => new Promise((res, rej) => {
      try {
        const ta = document.createElement("textarea");
        ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        ok ? res() : rej();
      } catch (e) { rej(e); }
    })) || Promise.reject();
  }

  function abrirConvite() {
    const antigo = sombra.getElementById("cartaoConvite");
    if (antigo) { antigo.remove(); return; }
    const url = `${OJ_CONFIG.SERVER_ORIGIN}/r/${S.sala.room}`;
    const campo = h("input", { class: "campo", value: url, readonly: true,
      onclick: (e) => e.target.select() });
    const cartao = h("div", { class: "convitePop", id: "cartaoConvite" }, [
      h("div", { class: "salaTit", style: "padding:0 0 6px", text: `Convite — sala ${S.sala.room}` }),
      campo,
      h("div", { class: "linha", style: "margin-top:8px" }, [
        h("button", { class: "bt eu", text: "Copiar link", onclick: (e) => {
          copiarTexto(url).then(
            () => { e.target.textContent = "Copiado ✓"; setTimeout(() => e.target.textContent = "Copiar link", 1600); },
            () => { campo.focus(); campo.select(); torrada("Selecione e copie com Ctrl+C."); });
        }}),
        h("button", { class: "bt", text: "Fechar", onclick: () => cartao.remove() })
      ]),
      h("div", { class: "aviso", style: "margin-top:8px",
        text: "Quem abrir o link instala a extensão (se ainda não tiver) e cai direto nesta sala." })
    ]);
    raiz.appendChild(cartao);
  }

  let tempTorrada = null;
  function torrada(msg, boa = false) {
    const el = sombra?.getElementById("torrada");
    if (!el) return;
    el.textContent = msg;
    el.style.background = boa ? "var(--live)" : "var(--warn)";
    el.hidden = false;
    clearTimeout(tempTorrada);
    tempTorrada = setTimeout(() => { el.hidden = true; }, 3600);
  }

  // =================================================================
  // Interface
  // =================================================================

  function montar() {
    const host = document.createElement("div");
    host.id = "ouvir-junto-host";
    document.documentElement.appendChild(host);

    // O YouTube Music escuta o teclado da página inteira (espaço pausa,
    // "/" abre a busca...). Sem esta barreira, digitar no painel dispara
    // os atalhos dele e as letras somem. Nada do que é digitado aqui
    // dentro pode vazar para a página.
    for (const tipo of ["keydown", "keyup", "keypress", "wheel"]) {
      host.addEventListener(tipo, (e) => e.stopPropagation());
    }
    sombra = host.attachShadow({ mode: "open" });
    sombra.appendChild(h("style", { text: OJ_CSS }));

    const pilula = h("button", {
      class: "pilula", id: "pilula", hidden: true,
      onclick: () => { S.aberto = true; pintarTudo(); }
    }, [h("span", { class: "lampada", id: "lampadaPilula" }), h("span", { id: "textoPilula", text: "JAMigos" })]);

    raiz = h("div", { class: "raiz", id: "raiz" });
    sombra.appendChild(raiz);
    sombra.appendChild(pilula);
    pintarTudo();
  }

  let pinturaAdiada = null;
  function pintarTudo() {
    if (!sombra) return;
    // Se a pessoa está digitando (chat, busca, nome), não reconstruir o painel
    // por baixo dos dedos dela. Tenta de novo daqui a pouco.
    const foco = sombra.activeElement;
    if (foco && foco.tagName === "INPUT" && document.hasFocus()) {
      clearTimeout(pinturaAdiada);
      pinturaAdiada = setTimeout(pintarTudo, 2000);
      return;
    }
    const pilula = sombra.getElementById("pilula");
    pilula.hidden = S.aberto;
    raiz.hidden = !S.aberto;
    sombra.getElementById("textoPilula").textContent =
      S.entrei && S.sala
        ? `Sala ${S.sala.room} · ${S.sala.members.length} 🎧`
        : "JAMigos";
    const lp = sombra.getElementById("lampadaPilula");
    lp.className = "lampada " + (!S.entrei ? "off" : S.desligado ? "off" : S.sala?.playing ? "live" : "");

    raiz.textContent = "";
    raiz.classList.toggle("desligado", S.desligado);
    if (S.entrei && S.conexao !== "aberto") {
      raiz.appendChild(h("div", { class: "faixaQueda",
        text: S.conexao === "reconectando"
          ? "⟳ Sem contato com o servidor — tentando voltar…"
          : "⟳ Conexão instável — reconectando…" }));
    }
    if (S.versaoNova) {
      raiz.appendChild(h("button", { class: "faixaVersao",
        text: "✦ Tem versão nova do JAMigos — clique pra baixar",
        onclick: () => window.open(OJ_CONFIG.SERVER_ORIGIN, "_blank") }));
    }
    raiz.appendChild(S.entrei && S.sala ? telaSala() : telaPorta());
    raiz.appendChild(h("div", { class: "torrada", id: "torrada", hidden: true }));
    raiz.appendChild(pegador("larg"));
    raiz.appendChild(pegador("alt"));
  }

  // Bordas arrastáveis: largura pela esquerda, altura pelo topo.
  function pegador(eixo) {
    const el = h("div", { class: eixo === "larg" ? "pegadorL" : "pegadorT",
      title: eixo === "larg" ? "Arraste para alargar" : "Arraste para aumentar a altura" });
    el.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      const x0 = ev.clientX, y0 = ev.clientY;
      const larg0 = S.largura, topo0 = S.topo;
      const mover = (e) => {
        if (eixo === "larg") {
          S.largura = Math.min(Math.max(320, larg0 + (x0 - e.clientX)),
                               Math.min(900, window.innerWidth - 40));
        } else {
          S.topo = Math.min(Math.max(8, topo0 + (e.clientY - y0)),
                            window.innerHeight - 260);
        }
        aplicarTamanho();
      };
      const soltar = () => {
        el.removeEventListener("pointermove", mover);
        el.removeEventListener("pointerup", soltar);
        chrome.storage.local.set({ ojLargura: S.largura, ojTopo: S.topo });
      };
      el.addEventListener("pointermove", mover);
      el.addEventListener("pointerup", soltar);
    });
    return el;
  }

  // ---- porta de entrada -------------------------------------------

  function telaPorta() {
    const box = h("div", { class: "porta" });

    box.appendChild(h("div", { class: "marca", text: "JAMigos" }));
    box.appendChild(h("h2", {
      text: CODIGO_CONVITE ? `Sala ${CODIGO_CONVITE}` : "Bora ouvir junto?"
    }));
    box.appendChild(h("p", {
      text: CODIGO_CONVITE
        ? "Escolha como quer aparecer e entre. Todo mundo na sala ouve a mesma faixa, no mesmo segundo."
        : "Crie uma sala, mande o link e todo mundo passa a ouvir a mesma faixa, no mesmo segundo."
    }));

    const nome = h("input", {
      class: "campo", id: "campoNome", maxlength: "24",
      placeholder: "Seu nome na sala", value: ""
    });
    const btEmoji = h("button", { class: "emojiBt", id: "btEmoji", text: "🎧",
      onclick: () => { const g = sombra.getElementById("grade"); g.hidden = !g.hidden; } });

    chrome.storage.local.get(["ojNome", "ojEmoji"]).then((v) => {
      if (v.ojNome) nome.value = v.ojNome;
      if (v.ojEmoji) btEmoji.textContent = v.ojEmoji;
    });

    box.appendChild(h("div", { class: "linha" }, [btEmoji, nome]));

    const grade = h("div", { class: "emojiGrade", id: "grade", hidden: true },
      EMOJIS.map((e) => h("button", { text: e, onclick: () => {
        btEmoji.textContent = e;
        sombra.getElementById("grade").hidden = true;
      }})));
    grade.style.position = "static";
    grade.style.boxShadow = "none";
    box.appendChild(grade);

    if (CODIGO_CONVITE) {
      box.appendChild(h("button", {
        class: "bt eu", text: `Entrar na sala ${CODIGO_CONVITE}`,
        onclick: () => entrar(CODIGO_CONVITE)
      }));
      box.appendChild(h("div", { class: "ou", text: "ou" }));
    }

    box.appendChild(h("button", {
      class: "bt eu", text: "Criar uma sala nova", onclick: () => entrar("")
    }));

    box.appendChild(h("div", { class: "ou", text: "ou entre com um código" }));
    const cod = h("input", { class: "campo", id: "campoCodigo", maxlength: "6",
      placeholder: "ABC123", style: "text-transform:uppercase;letter-spacing:.12em" });
    cod.addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(cod.value); });
    box.appendChild(cod);
    box.appendChild(h("button", { class: "bt", text: "Entrar", onclick: () => entrar(cod.value) }));

    if (S.conexao === "reconectando" || S.conexao === "erro" || S.conexao === "fechado") {
      box.appendChild(h("p", {
        class: "aviso",
        text: "Sem contato com o servidor. Ele pode ter caído — tente de novo em alguns instantes; nada da sala se perde."
      }));
    }
    chrome.storage.local.get("ojSala").then((v) => {
      if (!v.ojSala || CODIGO_CONVITE || S.entrei) return;
      const b = sombra.getElementById("campoCodigo");
      if (b && !b.value) b.value = v.ojSala;
    });
    return box;
  }

  // ---- sala --------------------------------------------------------

  function telaSala() {
    const s = S.sala;
    const box = h("div", { style: "display:flex;flex-direction:column;height:100%;min-height:0" });

    // topo
    box.appendChild(h("div", { class: "topo" }, [
      h("span", { class: "marca", text: "JAMigos" }),
      h("button", { class: "codigo", title: "Convidar para a sala", onclick: abrirConvite },
        [h("span", { text: s.room }), h("span", { text: "⧉", style: "opacity:.6" })]),
      h("button", { class: "icone", title: "Sair da sala", text: "⏻", onclick: sair }),
      h("button", { class: "icone", title: "Encolher", text: "—",
        onclick: () => { S.aberto = false; pintarTudo(); } })
    ]));

    // mostrador
    const mostrador = h("div", { class: "mostrador", id: "mostrador" });
    box.appendChild(mostrador);

    // controles — enxutos: sua pausa, o voto, e (só para o dono) o resto
    const ctr = h("div", { class: "controles" });
    if (S.desligado) {
      ctr.appendChild(h("button", { class: "bt eu", text: "▶  Voltar pro som da sala", onclick: voltarProSom }));
      ctr.appendChild(h("div", { class: "aviso", text: "A sala continuou sem você. Ao voltar, você cai no ponto exato." }));
    } else {
      ctr.appendChild(h("button", { class: "bt eu", text: "⏸  Pausar só pra mim", onclick: desligarDeMim, disabled: !s.now }));
      ctr.appendChild(h("button", {
        class: "bt todos", disabled: !s.now,
        text: `👎  Votar para pular  (${s.downvotes || 0}/${s.voteThreshold || 3})`,
        title: "Quando os votos baterem a meta, a música pula sozinha para todo mundo.",
        onclick: () => enviar({ t: "downvote" })
      }));
      if (S.eu?.isOwner) {
        ctr.appendChild(h("div", { class: "linha" }, [
          h("button", {
            class: "bt", disabled: !s.now,
            text: s.playing ? "⏸ Pausar pra todos" : "▶ Retomar pra todos",
            onclick: () => enviar({ t: s.playing ? "pause_all" : "play_all" })
          }),
          h("button", {
            class: "bt", text: "⏭ Pular pra todos", disabled: !s.now,
            onclick: () => enviar({ t: "skip_all" })
          })
        ]));
      }
      if (s.now) {
        const reagir = (e) => () => { enviar({ t: "react", emoji: e }); flutuar(e, null, S.cor); };
        ctr.appendChild(h("div", { class: "reacoes" }, [
          h("button", { class: "rebt", text: "🔥", title: "Mandar um 🔥", onclick: reagir("🔥") }),
          h("button", { class: "rebt", text: "❤️", title: "Mandar um ❤️", onclick: reagir("❤️") }),
          h("button", { class: "rebt", text: "😴", title: "Mandar um 😴", onclick: reagir("😴") })
        ]));
      }
    }
    box.appendChild(ctr);

    // abas: MÚSICAS | SALA
    const mkAba = (id, rot) => h("button", {
      class: "aba", role: "tab", "aria-selected": String(S.aba === id),
      text: rot, onclick: () => { S.aba = id; pintarTudo(); }
    });
    box.appendChild(h("div", { class: "abas", role: "tablist" }, [
      mkAba("fila", `Músicas (${s.queue.length})`),
      mkAba("sala", `Sala (${s.members.length})`),
      mkAba("ajustes", "Ajustes")
    ]));

    const painel = h("div", { class: "painel", id: "painel" });
    box.appendChild(painel);

    setTimeout(() => { pintarMostrador(); pintarLista(); }, 0);
    return box;
  }

  function rodape() {
    const eu = S.sala.members.find((m) => m.id === S.eu?.id);
    const btEmoji = h("button", { class: "emojiBt", text: eu?.emoji || "🎧",
      onclick: () => { const g = sombra.getElementById("gradeRodape"); g.hidden = !g.hidden; } });
    const nome = h("input", { class: "campo", maxlength: "24", value: eu?.name || "", placeholder: "Seu nome" });

    const salvar = () => {
      enviar({ t: "rename", name: nome.value.trim() || "Convidado", emoji: btEmoji.textContent.trim() });
      chrome.storage.local.set({ ojNome: nome.value.trim(), ojEmoji: btEmoji.textContent.trim() });
    };
    nome.addEventListener("change", salvar);
    nome.addEventListener("keydown", (e) => { if (e.key === "Enter") { salvar(); nome.blur(); } });

    const grade = h("div", { class: "emojiGrade", id: "gradeRodape", hidden: true },
      EMOJIS.map((e) => h("button", { text: e, onclick: () => {
        btEmoji.textContent = e;
        sombra.getElementById("gradeRodape").hidden = true;
        salvar();
      }})));

    return h("div", { style: "position:relative" }, [
      grade,
      h("div", { class: "rodape" }, [btEmoji, nome])
    ]);
  }

  // ---- mostrador ---------------------------------------------------

  function pintarMostrador() {
    const el = sombra?.getElementById("mostrador");
    if (!el || !S.sala) return;
    const s = S.sala;

    if (!s.now) {
      el.textContent = "";
      el.appendChild(h("div", { class: "vazio",
        text: "Nada tocando. Busque uma música aí embaixo ou jogue o link de uma faixa do YouTube Music." }));
      return;
    }

    const pos = S.desligado ? posicaoAlvo() : (S.player.time || posicaoAlvo());
    const dur = s.now.duration || S.player.duration || 0;
    const pct = dur ? Math.min(100, (pos / dur) * 100) : 0;

    el.textContent = "";
    const capa = h("img", { class: "capa", alt: "",
      src: `https://i.ytimg.com/vi/${s.now.videoId}/mqdefault.jpg` });
    capa.addEventListener("error", () => { capa.style.display = "none"; });
    el.appendChild(h("div", { class: "cabecalho" }, [
      capa,
      h("div", { class: "txtFaixa" }, [
        h("div", { class: "faixaTitulo", text: s.now.title }),
        s.now.artist ? h("div", { class: "faixaArtista", text: s.now.artist }) : null,
        h("div", { class: "faixaQuem", text: `entrou por ${s.now.addedByName || "alguém"}` })
      ])
    ]));

    const cheio = h("div", { class: "cheio" });
    cheio.style.width = pct + "%";
    const agulha = h("div", { class: "agulha" });
    agulha.style.left = `calc(${pct}% - 1px)`;

    const fita = h("div", { class: "fita", title: "Clique para mover a faixa — para todos" }, [
      h("div", { class: "trilho" }, [cheio]), agulha
    ]);
    fita.addEventListener("click", (e) => {
      if (!dur) return;
      const r = fita.getBoundingClientRect();
      enviar({ t: "seek_all", position: ((e.clientX - r.left) / r.width) * dur });
    });
    el.appendChild(fita);
    el.appendChild(h("div", { class: "contadores" }, [
      h("span", { text: rel(pos) }), h("span", { text: rel(dur) })
    ]));
  }

  // ---- fila e registro --------------------------------------------

  function pintarLista() {
    const p = sombra?.getElementById("painel");
    if (!p || !S.sala) return;
    p.textContent = "";
    if (S.aba === "fila") p.appendChild(blocoFila());
    else if (S.aba === "ajustes") p.appendChild(blocoAjustes());
    else p.appendChild(blocoSala());
  }

  function linhaDePessoa(m) {
    const st = m.inAd ? "📺 anúncio" : (m.detached ? "⏸ pausou pra si" : "🎶 ouvindo");
    const ponto = h("span", { class: "corPonto" });
    ponto.style.background = m.color || "#FF4FA0";
    return h("div", { class: "pessoaL" + (m.id === S.eu?.id ? " voce" : "") }, [
      ponto,
      h("span", { text: `${m.emoji || "🎧"} ${m.name}` }),
      m.isOwner ? h("span", { class: "dono", text: "👑" }) : null,
      h("span", { class: "st", text: st })
    ]);
  }

  // Atualiza SÓ a lista de pessoas — funciona mesmo enquanto você digita,
  // quando o redesenho completo do painel fica adiado.
  function pintarPessoas() {
    const el = sombra?.getElementById("listaPessoas");
    if (!el || !S.sala) return;
    el.textContent = "";
    S.sala.members.forEach((m) => el.appendChild(linhaDePessoa(m)));
    const abas = sombra.querySelectorAll(".aba");
    if (abas?.[1] && S.aba === "sala")
      abas[1].textContent = `Sala (${S.sala.members.length})`;
  }

  function blocoFila() {
    const frag = document.createDocumentFragment();
    const s = S.sala;

    frag.appendChild(h("div", { class: "busca" }, [
      h("button", { class: "bt", text: "＋ Adicionar a que está tocando aqui", onclick: adicionarAtual }),
      h("div", { class: "aviso",
        text: "Pra encher a fila, use a pesquisa do próprio YouTube Music: passe o mouse numa música e clique no ＋ rosa." })
    ]));

    if (!s.queue.length) {
      frag.appendChild(h("div", { class: "recado",
        text: "A fila está vazia. Qualquer pessoa da sala pode encher." }));
      return frag;
    }

    if (S.eu?.isOwner) {
      frag.appendChild(h("button", {
        class: "recado", style: "width:100%;padding:8px;color:var(--muted)",
        text: "Limpar a fila", onclick: () => enviar({ t: "clear" })
      }));
    }

    s.queue.forEach((f, i) => {
      const meu = f.addedBy === S.eu?.id || S.eu?.isOwner;
      frag.appendChild(h("div", { class: "item" }, [
        h("div", { class: "num", text: String(i + 1).padStart(2, "0") }),
        h("div", { class: "txt" }, [
          h("div", { class: "t", text: f.title }),
          h("div", { class: "s", text: [f.artist, `por ${f.addedByName}`].filter(Boolean).join(" · ") })
        ]),
        i > 0 ? h("button", { class: "acao", text: "↑", title: "Subir",
          onclick: () => enviar({ t: "move", trackId: f.id, delta: -1 }) }) : null,
        meu ? h("button", { class: "acao", text: "✕", title: "Tirar da fila",
          onclick: () => enviar({ t: "remove", trackId: f.id }) }) : null
      ]));
    });
    return frag;
  }

  function blocoAjustes() {
    const frag = document.createDocumentFragment();
    const eu = S.sala.members.find((m) => m.id === S.eu?.id);

    const salvarPerfil = () => {
      const nome = sombra.getElementById("ajNome").value.trim() || "Convidado";
      const emoji = sombra.getElementById("ajEmoji").textContent.trim();
      enviar({ t: "rename", name: nome, emoji, color: S.cor });
      chrome.storage.local.set({ ojNome: nome, ojEmoji: emoji, ojCor: S.cor });
    };

    // --- nome e ícone ---
    frag.appendChild(h("div", { class: "salaTit", text: "Seu nome e ícone" }));
    const btEmoji = h("button", { class: "emojiBt", id: "ajEmoji", text: eu?.emoji || "🎧",
      onclick: () => { const g = sombra.getElementById("gradeAj"); g.hidden = !g.hidden; } });
    const nome = h("input", { class: "campo", id: "ajNome", maxlength: "24",
      value: eu?.name || "", placeholder: "Como você aparece na sala" });
    nome.addEventListener("change", salvarPerfil);
    nome.addEventListener("keydown", (e) => { if (e.key === "Enter") { salvarPerfil(); nome.blur(); } });
    frag.appendChild(h("div", { class: "bloco" }, [
      h("div", { class: "linha" }, [btEmoji, nome]),
      h("div", { class: "emojiGrade", id: "gradeAj", hidden: true, style: "position:static;box-shadow:none;margin-top:8px" },
        EMOJIS.map((e) => h("button", { text: e, onclick: () => {
          btEmoji.textContent = e;
          sombra.getElementById("gradeAj").hidden = true;
          salvarPerfil();
        }})))
    ]));

    // --- cor ---
    frag.appendChild(h("div", { class: "salaTit", text: "Sua cor" }));
    const grade = h("div", { class: "coresGrade" });
    CORES.forEach((cor) => {
      const b = h("button", { class: "corBt" + (S.cor === cor ? " ativa" : ""),
        title: cor, onclick: () => { S.cor = cor; salvarPerfil(); pintarLista(); } });
      b.style.background = cor;
      grade.appendChild(b);
    });
    frag.appendChild(h("div", { class: "bloco" }, [grade]));

    // --- reações ---
    frag.appendChild(h("div", { class: "salaTit", text: "Na sua tela" }));
    const chave = (rotulo, desc, valor, onToggle) => {
      const sw = h("button", { class: "chave" + (valor ? " on" : ""), role: "switch",
        "aria-checked": String(valor) }, [h("i")]);
      const cx = h("div", { class: "opcao", onclick: () => {
        const novo = !sw.classList.contains("on");
        sw.classList.toggle("on", novo);
        sw.setAttribute("aria-checked", String(novo));
        onToggle(novo);
      }}, [
        h("div", {}, [h("div", { class: "opcaoT", text: rotulo }),
                      h("div", { class: "opcaoD", text: desc })]),
        sw
      ]);
      return cx;
    };
    frag.appendChild(h("div", { class: "bloco" }, [
      chave("Reações flutuantes", "Ver os emojis que a galera manda subindo na tela.",
        S.verReacoes, (v) => { S.verReacoes = v; chrome.storage.local.set({ ojVerReacoes: v }); }),
      chave("Avisos de música", "Ver o aviso quando alguém põe música na fila.",
        S.verAvisos, (v) => { S.verAvisos = v; chrome.storage.local.set({ ojVerAvisos: v }); })
    ]));

    // --- tamanho do painel ---
    frag.appendChild(h("div", { class: "salaTit", text: "Tamanho do painel" }));
    frag.appendChild(h("div", { class: "bloco" }, [
      h("div", { class: "opcaoD",
        text: "Arraste a borda esquerda do painel para alargar, e a borda de cima para deixá-lo mais alto." }),
      h("button", { class: "bt", style: "margin-top:9px", text: "Voltar ao tamanho padrão",
        onclick: () => {
          S.largura = 372; S.topo = 72;
          chrome.storage.local.set({ ojLargura: 372, ojTopo: 72 });
          aplicarTamanho();
        }})
    ]));

    // --- sobre ---
    frag.appendChild(h("div", { class: "salaTit", text: "Sobre" }));
    frag.appendChild(h("div", { class: "bloco" }, [
      h("div", { class: "opcaoD", text: `JAMigos ${OJ_CONFIG.VERSION}` }),
      h("div", { class: "opcaoD", text: OJ_CONFIG.SERVER_ORIGIN.replace(/^https?:\/\//, "") })
    ]));

    return frag;
  }

  function linhaDoRegistro(e) {
    const txt = h("span", { class: "txt", text: e.text });
    if (e.kind === "chat" && e.color) {
      txt.style.borderLeft = `3px solid ${e.color}`;
      txt.style.paddingLeft = "8px";
    }
    const filhos = [
      h("span", { class: "hora", text: hora(e.ts) }),
      txt
    ];
    // Eventos de música guardam a faixa: dá pra tocar de novo direto daqui.
    if (e.track && e.track.videoId) {
      filhos.push(h("button", { class: "acao somar reAdd", text: "＋",
        title: "Adicionar de novo à fila",
        onclick: () => { enviar({ t: "add", track: e.track }); } }));
    }
    return h("div", { class: "evento " + e.kind }, filhos);
  }

  function blocoSala() {
    const frag = document.createDocumentFragment();

    frag.appendChild(h("div", { class: "salaTit", text: "Quem está aqui" }));
    const lista = h("div", { class: "pessoasV", id: "listaPessoas" });
    S.sala.members.forEach((m) => lista.appendChild(linhaDePessoa(m)));
    frag.appendChild(lista);

    frag.appendChild(h("div", { class: "salaTit", text: "Conversa e registro" }));
    const box = h("div", { class: "log", id: "log" });
    if (!S.registro.length) {
      box.appendChild(h("div", { class: "recado", text: "Tudo que rolar aparece aqui — e o chat é logo abaixo." }));
    } else {
      S.registro.forEach((e) => box.appendChild(linhaDoRegistro(e)));
    }
    frag.appendChild(box);

    const campo = h("input", {
      class: "campo", id: "campoChat", maxlength: "280",
      placeholder: "Dizer algo pra sala…", value: S.rascunhoChat
    });
    campo.addEventListener("input", () => { S.rascunhoChat = campo.value; });
    const mandar = () => {
      const txt = campo.value.trim();
      if (!txt) return;
      enviar({ t: "chat", text: txt });
      campo.value = ""; S.rascunhoChat = "";
    };
    campo.addEventListener("keydown", (e) => { if (e.key === "Enter") mandar(); });
    frag.appendChild(h("div", { class: "chatLinha" }, [
      campo,
      h("button", { class: "bt", style: "flex:0 0 auto;padding:10px 14px", text: "➤", title: "Enviar", onclick: mandar })
    ]));

    setTimeout(() => { const p = sombra.getElementById("painel"); p?.scrollTo(0, 1e6); }, 0);
    return frag;
  }

  function pintarRegistro() {
    if (S.aba === "sala") {
      const box = sombra?.getElementById("log");
      if (box) {
        box.appendChild(linhaDoRegistro(S.registro[S.registro.length - 1]));
        const p = sombra.getElementById("painel");
        p?.scrollTo(0, 1e6);
      } else {
        pintarLista();
      }
    } else {
      const abas = sombra?.querySelectorAll(".aba");
      if (abas?.[1]) abas[1].textContent = `Sala (${S.sala?.members.length ?? ""}) •`;
    }
  }

  // Reações e avisos flutuam por cima do PRÓPRIO YouTube Music,
  // na tela de todo mundo — até de quem está com o painel minimizado.
  let palco = null;
  function pegarPalco() {
    if (palco && palco.isConnected) return palco;
    palco = document.createElement("div");
    palco.id = "oj-palco";
    document.documentElement.appendChild(palco);
    return palco;
  }

  function flutuar(emoji, quem, cor) {
    if (!S.verReacoes) return;
    const p = pegarPalco();
    const el = document.createElement("div");
    el.className = "oj-reacao";
    el.textContent = emoji;
    el.style.left = (18 + Math.random() * 64) + "%";
    el.style.fontSize = (34 + Math.random() * 22) + "px";
    p.appendChild(el);
    if (quem) {
      const et = document.createElement("div");
      et.className = "oj-reacaoQuem";
      et.textContent = quem;
      et.style.left = el.style.left;
      if (cor) et.style.color = cor;
      p.appendChild(et);
      setTimeout(() => et.remove(), 2400);
    }
    setTimeout(() => el.remove(), 2400);
  }

  function avisoNaTela(texto) {
    if (!S.verAvisos) return;
    const p = pegarPalco();
    const el = document.createElement("div");
    el.className = "oj-aviso";
    el.textContent = texto;
    p.appendChild(el);
    setTimeout(() => el.classList.add("some"), 3600);
    setTimeout(() => el.remove(), 4200);
  }

  // =================================================================
  // Botões ＋ dentro do próprio YouTube Music
  // Cada música listada (busca, playlists, biblioteca, cards) ganha um
  // botão rosa que manda a faixa direto para a fila da sala.
  // =================================================================

  (function estiloDosBotoes() {
    const st = document.createElement("style");
    st.textContent = `
      .oj-add { display: none; position: absolute; z-index: 30;
        width: 30px; height: 30px; border-radius: 50%;
        align-items: center; justify-content: center;
        background: linear-gradient(135deg, #FF4FA0, #8B5CF6);
        color: #fff; font: 700 17px/1 sans-serif; border: 0; cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,.45); opacity: 0; transition: opacity .12s; }
      html.oj-na-sala .oj-add { display: flex; }
      *:hover > .oj-add, .oj-add:focus-visible { opacity: 1; }
      .oj-add:hover { filter: brightness(1.15); }
      .oj-add.ok { background: #C6F53F; color: #1B2404; }

      #oj-palco { position: fixed; inset: 0; pointer-events: none; z-index: 2147483001; }
      .oj-reacao {
        position: absolute; bottom: 16%; pointer-events: none;
        animation: oj-sobe 2.3s ease-out forwards;
        filter: drop-shadow(0 4px 10px rgba(0,0,0,.5));
      }
      .oj-reacaoQuem {
        position: absolute; bottom: 13%; pointer-events: none;
        font: 700 12px/1 sans-serif; color: #fff;
        text-shadow: 0 1px 6px rgba(0,0,0,.8);
        animation: oj-sobe 2.3s ease-out forwards;
      }
      @keyframes oj-sobe {
        0%   { transform: translateY(0) scale(.6) rotate(-4deg); opacity: 0; }
        12%  { transform: translateY(-24px) scale(1.1) rotate(3deg); opacity: 1; }
        100% { transform: translateY(-46vh) scale(1) rotate(-2deg); opacity: 0; }
      }
      .oj-aviso {
        position: absolute; top: 76px; left: 50%; transform: translateX(-50%);
        max-width: min(80vw, 460px); pointer-events: none;
        padding: 10px 18px; border-radius: 999px;
        background: linear-gradient(135deg, #FF4FA0, #8B5CF6);
        color: #fff; font: 700 13.5px/1.3 sans-serif;
        box-shadow: 0 10px 30px rgba(0,0,0,.45);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        transition: opacity .5s, transform .5s;
      }
      .oj-aviso.some { opacity: 0; transform: translateX(-50%) translateY(-14px); }
      @media (prefers-reduced-motion: reduce) {
        .oj-reacao, .oj-reacaoQuem { animation: none; opacity: 0; }
      }
    `;
    (document.head || document.documentElement).appendChild(st);
  })();

  function infoDoItem(el) {
    const a = el.querySelector('a[href*="watch?v="]');
    if (!a) return null;
    const m = /[?&]v=([A-Za-z0-9_-]{11})/.exec(a.getAttribute("href") || "");
    if (!m) return null;
    const titulo =
      el.querySelector(".title")?.textContent?.trim() ||
      a.textContent.trim() || "Faixa";
    let artista = "";
    const colunas = el.querySelectorAll("yt-formatted-string.flex-column");
    if (colunas.length > 1) artista = (colunas[1].textContent || "").split("•")[0].trim();
    else {
      const sub = el.querySelector(".subtitle, .byline");
      if (sub) artista = (sub.textContent || "").split("•")[0].trim();
    }
    const dm = /(\d+):(\d{2})(?!\d)/.exec(el.textContent || "");
    const dur = dm ? (+dm[1]) * 60 + (+dm[2]) : 0;
    return { videoId: m[1], title: titulo, artist: artista, duration: dur };
  }

  function plantarBotao(el, estilo) {
    if (el.dataset.ojBtn) return;
    el.dataset.ojBtn = "1";
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    const bt = document.createElement("button");
    bt.className = "oj-add";
    bt.type = "button";
    bt.textContent = "＋";
    bt.title = "Adicionar à sala JAMigos";
    Object.assign(bt.style, estilo);
    bt.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!S.entrei) return;
      const f = infoDoItem(el);
      if (!f) { torrada("Não consegui identificar essa faixa."); return; }
      enviar({ t: "add", track: f });
      bt.textContent = "✓"; bt.classList.add("ok");
      setTimeout(() => { bt.textContent = "＋"; bt.classList.remove("ok"); }, 1600);
    }, true);
    el.appendChild(bt);
  }

  setInterval(() => {
    if (!S.entrei) return;
    // linhas de lista (busca, playlists, biblioteca): botão à direita, antes do menu
    document.querySelectorAll(
      "ytmusic-responsive-list-item-renderer:not([data-oj-btn])"
    ).forEach((el) => {
      if (el.querySelector('a[href*="watch?v="]'))
        plantarBotao(el, { right: "56px", top: "50%", transform: "translateY(-50%)" });
      else el.dataset.ojBtn = "1"; // álbum/artista sem faixa direta: ignora
    });
    // cards com capa (destaques, "para você"): botão no canto da capa
    document.querySelectorAll(
      "ytmusic-two-row-item-renderer:not([data-oj-btn])"
    ).forEach((el) => {
      if (el.querySelector('a[href*="watch?v="]'))
        plantarBotao(el, { right: "8px", top: "8px" });
      else el.dataset.ojBtn = "1";
    });
  }, 1200);

  // =================================================================
  // Início
  // =================================================================

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.t === "toggle-panel") { S.aberto = !S.aberto; pintarTudo(); }
  });

  async function carregarPreferencias() {
    const v = await chrome.storage.local.get(
      ["ojCor", "ojVerReacoes", "ojVerAvisos", "ojLargura", "ojTopo"]);
    if (v.ojCor) S.cor = v.ojCor;
    if (v.ojVerReacoes !== undefined) S.verReacoes = v.ojVerReacoes;
    if (v.ojVerAvisos !== undefined) S.verAvisos = v.ojVerAvisos;
    if (v.ojLargura) S.largura = v.ojLargura;
    if (v.ojTopo) S.topo = v.ojTopo;
    aplicarTamanho();
  }

  function aplicarTamanho() {
    if (!raiz) return;
    raiz.style.width = S.largura + "px";
    raiz.style.top = S.topo + "px";
  }

  function iniciar() {
    if (!document.documentElement) return setTimeout(iniciar, 200);
    montar();
    carregarPreferencias();
    abrirPorta();
    // Recarregou a página no meio da festa? Volta sozinho pra sala.
    setTimeout(async () => {
      if (S.entrei || CODIGO_CONVITE) return;
      const v = await chrome.storage.local.get(["ojSala", "ojNome", "ojEmoji"]);
      if (v.ojSala) {
        torrada(`Voltando pra sala ${v.ojSala}…`, true);
        entrar(v.ojSala, v.ojNome, v.ojEmoji);
      }
    }, 900);
  }
  iniciar();
})();
