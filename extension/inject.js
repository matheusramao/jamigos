/**
 * Roda no contexto da própria página do YouTube Music (mundo MAIN),
 * porque só de lá dá para falar com o objeto do player.
 *
 * Conversa com o content script por window.postMessage.
 *   página  -> content : { __oj: "p2c", ... }
 *   content -> página  : { __oj: "c2p", ... }
 */

(() => {
  if (window.__ouvirJuntoInjetado) return;
  window.__ouvirJuntoInjetado = true;

  const paraContent = (payload) =>
    window.postMessage({ __oj: "p2c", ...payload }, "*");

  const player = () => {
    const p = document.getElementById("movie_player");
    return p && typeof p.getPlayerState === "function" ? p : null;
  };

  const video = () => document.querySelector("video");

  // ---------------------------------------------------------------
  // Leitura de estado
  // ---------------------------------------------------------------

  function metadadosDaBarra() {
    const barra = document.querySelector("ytmusic-player-bar");
    if (!barra) return {};
    const titulo = barra.querySelector(".title")?.textContent?.trim();
    const linha = barra.querySelector(".byline")?.textContent?.trim();
    let artista = "";
    if (linha) artista = linha.split("•")[0].trim();
    return { title: titulo || "", artist: artista };
  }

  function faixaAtual() {
    const p = player();
    let dados = {};
    try {
      dados = p?.getVideoData?.() || {};
    } catch (_) {}
    const barra = metadadosDaBarra();
    let duracao = 0;
    try {
      duracao = p?.getDuration?.() || video()?.duration || 0;
    } catch (_) {}
    return {
      videoId: dados.video_id || "",
      title: barra.title || dados.title || "",
      artist: barra.artist || dados.author || "",
      duration: Number.isFinite(duracao) ? duracao : 0
    };
  }

  // ---------------------------------------------------------------
  // Pulso: manda o estado do player para o content script
  // ---------------------------------------------------------------

  let ultimoVideoId = "";
  let jaAvisouFim = "";

  function emAnuncio(p) {
    // O YouTube marca o próprio player com estas classes durante um anúncio.
    try {
      return !!(p.classList &&
        (p.classList.contains("ad-showing") || p.classList.contains("ad-interrupting")));
    } catch (_) {
      return false;
    }
  }

  setInterval(() => {
    const p = player();
    if (!p) return;
    let estado = -1, tempo = 0, duracao = 0;
    try {
      estado = p.getPlayerState();
      tempo = p.getCurrentTime() || 0;
      duracao = p.getDuration() || 0;
    } catch (_) {
      return;
    }

    // Durante um anúncio, tempo, duração e videoId são os DO ANÚNCIO.
    // Nada disso pode contaminar a sincronização nem disparar "fim de faixa".
    if (emAnuncio(p)) {
      paraContent({ ev: "tick", ad: true, state: estado,
                    time: 0, duration: 0, track: { videoId: "", title: "", artist: "", duration: 0 } });
      return;
    }

    const f = faixaAtual();

    if (f.videoId && f.videoId !== ultimoVideoId) {
      ultimoVideoId = f.videoId;
      jaAvisouFim = "";
    }

    // 0 = terminou
    if (estado === 0 && ultimoVideoId && jaAvisouFim !== ultimoVideoId) {
      jaAvisouFim = ultimoVideoId;
      try {
        p.pauseVideo();
      } catch (_) {}
      paraContent({ ev: "ended", videoId: ultimoVideoId });
    }

    paraContent({
      ev: "tick",
      ad: false,
      time: tempo,
      duration: duracao,
      state: estado,
      track: f
    });
  }, 500);

  // ---------------------------------------------------------------
  // Busca pela API interna do YouTube Music
  // ---------------------------------------------------------------

  function coletar(no, chave, saida) {
    if (!no || typeof no !== "object") return saida;
    if (Array.isArray(no)) {
      for (const item of no) coletar(item, chave, saida);
      return saida;
    }
    for (const k of Object.keys(no)) {
      if (k === chave) saida.push(no[k]);
      else coletar(no[k], chave, saida);
    }
    return saida;
  }

  const textoDe = (col) =>
    (col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [])
      .map((r) => r.text)
      .join("");

  function paraSegundos(txt) {
    const m = /(\d+):(\d{2})(?::(\d{2}))?/.exec(txt || "");
    if (!m) return 0;
    return m[3]
      ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])
      : (+m[1]) * 60 + (+m[2]);
  }

  async function buscar(consulta) {
    const cfg = window.ytcfg;
    const chave = cfg?.get?.("INNERTUBE_API_KEY");
    const contexto = cfg?.get?.("INNERTUBE_CONTEXT");
    if (!chave || !contexto) throw new Error("sem-api");

    const resp = await fetch(
      `/youtubei/v1/search?key=${chave}&prettyPrint=false`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: contexto,
          query: consulta,
          // filtro "só músicas"
          params: "EgWKAQIIAWoKEAoQCRADEAQQBQ%3D%3D"
        })
      }
    );
    if (!resp.ok) throw new Error("http-" + resp.status);
    const json = await resp.json();

    const itens = coletar(json, "musicResponsiveListItemRenderer", []);
    const saida = [];
    const vistos = new Set();

    for (const it of itens) {
      const vid =
        it?.playlistItemData?.videoId ||
        it?.overlay?.musicItemThumbnailOverlayRenderer?.content
          ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint
          ?.videoId ||
        coletar(it, "videoId", [])[0];
      if (!vid || vistos.has(vid)) continue;

      const colunas = it.flexColumns || [];
      const titulo = textoDe(colunas[0]);
      const legenda = textoDe(colunas[1]);
      if (!titulo) continue;

      const partes = legenda.split("•").map((s) => s.trim());
      const duracao = paraSegundos(partes[partes.length - 1]);
      const artista = partes.length > 1 ? partes[partes.length >= 3 ? 1 : 0] : partes[0];

      vistos.add(vid);
      saida.push({
        videoId: vid,
        title: titulo,
        artist: artista || "",
        duration: duracao
      });
      if (saida.length >= 12) break;
    }
    return saida;
  }

  // ---------------------------------------------------------------
  // Comandos vindos do content script
  // ---------------------------------------------------------------

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__oj !== "c2p") return;

    const p = player();

    try {
      switch (d.cmd) {
        case "load": {
          if (!p) return;
          jaAvisouFim = "";
          ultimoVideoId = d.videoId;
          const at = Math.max(0, d.at || 0);
          if (d.play) p.loadVideoById(d.videoId, at);
          else p.cueVideoById(d.videoId, at);
          break;
        }
        case "play":
          p?.playVideo?.();
          break;
        case "pause":
          p?.pauseVideo?.();
          break;
        case "seek":
          p?.seekTo?.(Math.max(0, d.to || 0), true);
          break;
        case "volume":
          p?.setVolume?.(Math.round(d.value));
          break;
        case "current":
          paraContent({ ev: "current", reqId: d.reqId, track: faixaAtual() });
          break;
        case "search": {
          try {
            const itens = await buscar(d.query);
            paraContent({ ev: "search", reqId: d.reqId, items: itens });
          } catch (err) {
            paraContent({
              ev: "search",
              reqId: d.reqId,
              items: [],
              error: String(err.message || err)
            });
          }
          break;
        }
      }
    } catch (err) {
      paraContent({ ev: "erro", detail: String(err) });
    }
  });

  paraContent({ ev: "pronto" });
})();
