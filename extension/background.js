/**
 * O WebSocket mora aqui, no service worker, e não no content script.
 * Motivo: a política de segurança do music.youtube.com pode barrar conexões
 * abertas de dentro da página. Daqui, não há essa restrição.
 *
 * O service worker do Manifest V3 dorme depois de ~30s parado. Três coisas o
 * mantêm acordado enquanto houver uma aba do YouTube Music aberta:
 * a porta de mensagens com o content script, o tráfego do próprio WebSocket
 * e o alarme de 25 em 25 segundos abaixo.
 */

const sessions = new Map(); // portId -> { port, ws, wsUrl, join, retry, timer }
let portSeq = 0;

chrome.alarms.create("oj-keepalive", { periodInMinutes: 0.4 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "oj-keepalive") return;
  for (const s of sessions.values()) {
    if (s.ws && s.ws.readyState === WebSocket.OPEN) {
      try {
        s.ws.send(JSON.stringify({ t: "ping", ts: Date.now() }));
      } catch (_) {}
    }
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.url?.startsWith("https://music.youtube.com/")) {
    chrome.tabs.sendMessage(tab.id, { t: "toggle-panel" }).catch(() => {});
  } else {
    chrome.tabs.create({ url: "https://music.youtube.com/" });
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ouvir-junto") return;

  const id = ++portSeq;
  const session = { port, ws: null, wsUrl: null, join: null, retry: 0, timer: null, closing: false };
  sessions.set(id, session);

  port.onMessage.addListener((msg) => {
    if (msg.t === "connect") {
      session.wsUrl = msg.wsUrl;
      session.join = msg.join;
      session.retry = 0;
      openSocket(id);
    } else if (msg.t === "send") {
      sendRaw(id, msg.payload);
    } else if (msg.t === "disconnect") {
      teardown(id, true);
    }
  });

  port.onDisconnect.addListener(() => teardown(id, true));
});

function post(id, payload) {
  const s = sessions.get(id);
  if (!s) return;
  try {
    s.port.postMessage(payload);
  } catch (_) {}
}

function sendRaw(id, payload) {
  const s = sessions.get(id);
  if (!s || !s.ws || s.ws.readyState !== WebSocket.OPEN) return;
  try {
    s.ws.send(JSON.stringify(payload));
  } catch (_) {}
}

function openSocket(id) {
  const s = sessions.get(id);
  if (!s || s.closing) return;

  if (s.ws) {
    try {
      s.ws.close();
    } catch (_) {}
    s.ws = null;
  }

  let ws;
  try {
    ws = new WebSocket(s.wsUrl);
  } catch (err) {
    post(id, { t: "status", status: "erro", detail: String(err) });
    scheduleRetry(id);
    return;
  }
  s.ws = ws;
  post(id, { t: "status", status: "conectando" });

  ws.onopen = () => {
    s.retry = 0;
    post(id, { t: "status", status: "aberto" });
    if (s.join) sendRaw(id, { t: "join", ...s.join });
  };

  ws.onmessage = (ev) => {
    let data;
    try {
      data = JSON.parse(ev.data);
    } catch (_) {
      return;
    }
    if (data.t === "welcome" && s.join) {
      // Guarda o código real da sala para reconectar no mesmo lugar.
      s.join.room = data.state?.room || s.join.room;
    }
    post(id, { t: "msg", payload: data });
  };

  ws.onclose = () => {
    post(id, { t: "status", status: "fechado" });
    scheduleRetry(id);
  };

  ws.onerror = () => {
    post(id, { t: "status", status: "erro" });
  };
}

function scheduleRetry(id) {
  const s = sessions.get(id);
  if (!s || s.closing || !s.wsUrl) return;
  if (s.timer) clearTimeout(s.timer);
  const espera = Math.min(1000 * Math.pow(1.6, s.retry++), 15000);
  post(id, { t: "status", status: "reconectando", emMs: espera });
  s.timer = setTimeout(() => openSocket(id), espera);
}

function teardown(id, remove) {
  const s = sessions.get(id);
  if (!s) return;
  s.closing = true;
  if (s.timer) clearTimeout(s.timer);
  if (s.ws) {
    try {
      s.ws.close();
    } catch (_) {}
  }
  s.ws = null;
  if (remove) sessions.delete(id);
}
