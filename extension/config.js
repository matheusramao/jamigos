// Endereço do servidor de salas.
// O ZIP baixado pela página de instalação já vem com este valor preenchido.
// Se você estiver montando na mão, troque pelo endereço do seu servidor.
const OJ_CONFIG = {
  WS_URL: "__WS_URL__",
  SERVER_ORIGIN: "__SERVER_ORIGIN__",
  TOKEN: "__TOKEN__",
  VERSION: "1.4.0"
};

// Fallback para quem carregar a pasta sem passar pelo servidor.
if (OJ_CONFIG.WS_URL.startsWith("__")) OJ_CONFIG.WS_URL = "ws://localhost:8787/ws";
if (OJ_CONFIG.SERVER_ORIGIN.startsWith("__")) OJ_CONFIG.SERVER_ORIGIN = "http://localhost:8787";
if (OJ_CONFIG.TOKEN.startsWith("__")) OJ_CONFIG.TOKEN = "";
