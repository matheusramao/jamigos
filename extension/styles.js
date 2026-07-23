/* JAMigos — identidade jovem: roxo-uva profundo, rosa vibrante nas ações,
   verde-lima nos sinais de "ao vivo". O registro continua tipografado como
   um log, porque é um. */

const OJ_CSS = `
:host {
  --bg:      #150F22;
  --surface: #1E1732;
  --raise:   #2A2148;
  --line:    #3B2F60;
  --text:    #F6F3FF;
  --muted:   #9B91BD;
  --dial:    #FF4FA0;
  --dialDim: #7A2A58;
  --live:    #C6F53F;
  --warn:    #FF7A59;
  --grad:    linear-gradient(135deg, #FF4FA0 0%, #8B5CF6 100%);
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", "Roboto Mono", Menlo, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  all: initial;
}
* { box-sizing: border-box; margin: 0; padding: 0; font-family: var(--sans); }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--dial); outline-offset: 2px; }

/* ---------- casca ---------- */

.raiz {
  position: fixed; z-index: 2147483000;
  right: 16px; top: 72px; bottom: 88px;
  width: 372px; max-width: calc(100vw - 32px);
  display: flex; flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: 0 24px 60px rgba(10,4,26,.65);
  color: var(--text);
  overflow: hidden;
  transition: opacity .18s ease, transform .18s ease;
}
.raiz[hidden] { display: none; }

/* Quando você pausa só para si, a sala continua sem você — e o painel
   inteiro perde a cor para dizer isso sem precisar de texto. */
.raiz.desligado { filter: saturate(.15) brightness(.86); }

.pilula {
  position: fixed; z-index: 2147483000;
  right: 16px; bottom: 96px;
  display: flex; align-items: center; gap: 9px;
  padding: 9px 15px 9px 12px;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 999px; color: var(--text);
  font: 600 13px/1 var(--sans);
  box-shadow: 0 10px 28px rgba(0,0,0,.5);
}
.pilula:hover { border-color: var(--dialDim); }
.pilula[hidden] { display: none; }
.lampada {
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--dial); box-shadow: 0 0 9px var(--dial);
}
.lampada.off { background: #4A4066; box-shadow: none; }
.lampada.live { background: var(--live); box-shadow: 0 0 9px var(--live); }

/* ---------- aviso de queda ---------- */

.faixaQueda {
  width: 100%; padding: 8px 12px; text-align: center;
  background: var(--warn); color: #2A1108;
  font: 700 11.5px/1.3 var(--sans);
}

/* ---------- aviso de versão ---------- */

.faixaVersao {
  width: 100%; padding: 9px 12px; text-align: center;
  background: var(--grad); color: #fff;
  font: 700 12px/1.3 var(--sans); cursor: pointer;
}
.faixaVersao:hover { filter: brightness(1.1); }

/* ---------- topo ---------- */

.topo {
  display: flex; align-items: center; gap: 10px;
  padding: 13px 14px; border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, var(--raise), var(--surface));
}
.marca {
  font: 700 11px/1 var(--mono); letter-spacing: .18em;
  text-transform: uppercase; color: var(--dial);
}
.codigo {
  margin-left: auto; display: flex; align-items: center; gap: 6px;
  font: 700 13px/1 var(--mono); letter-spacing: .1em;
  padding: 5px 9px; border-radius: 7px;
  background: #0F0A1B; border: 1px solid var(--line); color: var(--text);
}
.icone { padding: 5px; border-radius: 7px; color: var(--muted); line-height: 0; }
.icone:hover { background: var(--raise); color: var(--text); }

/* ---------- mostrador ---------- */

.mostrador { padding: 15px 14px 13px; border-bottom: 1px solid var(--line); }
.faixaTitulo {
  font: 600 15px/1.3 var(--sans); color: var(--text);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.faixaArtista { margin-top: 3px; font: 400 12.5px/1.3 var(--sans); color: var(--muted); }
.faixaQuem { margin-top: 7px; font: 400 11px/1 var(--mono); color: var(--dialDim); }
.vazio { font: 400 13px/1.5 var(--sans); color: var(--muted); }

.fita {
  position: relative; margin-top: 13px; height: 22px; cursor: pointer;
}
.fita .trilho {
  position: absolute; left: 0; right: 0; top: 9px; height: 3px;
  background: #2A261F; border-radius: 2px; overflow: hidden;
}
.fita .cheio {
  position: absolute; left: 0; top: 0; bottom: 0; width: 0%;
  background: var(--grad); box-shadow: 0 0 12px rgba(255,79,160,.55);
  transition: width .25s linear;
}
.fita .agulha {
  position: absolute; top: 4px; width: 2px; height: 13px; left: 0;
  background: var(--text); border-radius: 1px;
  transition: left .25s linear;
}
.contadores {
  display: flex; justify-content: space-between;
  font: 500 10.5px/1 var(--mono); color: var(--muted); margin-top: -1px;
}

/* ---------- capa e convite ---------- */

.cabecalho { display: flex; gap: 12px; align-items: center; }
.capa {
  width: 56px; height: 56px; object-fit: cover; border-radius: 12px;
  border: 1px solid var(--line); flex: 0 0 56px;
  box-shadow: 0 6px 16px rgba(10,4,26,.5);
}
.txtFaixa { min-width: 0; }

.convitePop {
  position: absolute; top: 54px; left: 12px; right: 12px; z-index: 8;
  padding: 13px 14px; border-radius: 14px;
  background: var(--raise); border: 1px solid var(--line);
  box-shadow: 0 16px 40px rgba(10,4,26,.65);
}
.reAdd { flex: 0 0 auto; }

/* ---------- controles ---------- */

.controles { padding: 12px 14px; border-bottom: 1px solid var(--line); display: grid; gap: 8px; }
.linha { display: flex; gap: 8px; }
.bt {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 10px 8px; border-radius: 9px;
  background: var(--raise); border: 1px solid var(--line);
  font: 600 12.5px/1 var(--sans); color: var(--text);
}
.bt:hover { border-color: #57459A; background: #322754; }
.bt:disabled { opacity: .38; cursor: not-allowed; }
.bt.eu { background: var(--grad); border-color: transparent; color: #FFFFFF; }
.bt.eu:hover { filter: brightness(1.12); }
.bt.todos { color: var(--dial); border-color: var(--dialDim); background: #241636; }
.bt.todos:hover { background: #2E1B44; border-color: var(--dial); }
.aviso {
  font: 400 10.5px/1.4 var(--mono); color: var(--muted); text-align: center;
}

/* ---------- pessoas ---------- */

.pessoas {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 11px 14px; border-bottom: 1px solid var(--line);
}
.pessoa {
  display: flex; align-items: center; gap: 5px;
  padding: 4px 9px 4px 7px; border-radius: 999px;
  background: var(--raise); border: 1px solid var(--line);
  font: 500 11.5px/1 var(--sans); color: var(--text);
}
.pessoa.fora { opacity: .42; }
.pessoa.voce { border-color: var(--dialDim); }
.pessoa .dono { color: var(--dial); font-size: 10px; }

/* ---------- abas ---------- */

.abas { display: flex; border-bottom: 1px solid var(--line); background: var(--surface); }
.aba {
  flex: 1; padding: 10px 4px; text-align: center;
  font: 600 9.5px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase;
  color: var(--muted); border-bottom: 2px solid transparent;
}
.aba[aria-selected="true"] { color: var(--dial); border-bottom-color: var(--dial); }

.painel { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.painel[hidden] { display: none; }
.painel::-webkit-scrollbar { width: 8px; }
.painel::-webkit-scrollbar-thumb { background: #3B2F60; border-radius: 4px; }

/* ---------- busca / fila ---------- */

.busca { padding: 12px 14px 10px; display: grid; gap: 8px; }
.campo {
  width: 100%; padding: 10px 11px; border-radius: 11px;
  background: #0F0A1B; border: 1px solid var(--line);
  color: var(--text); font: 400 13px/1.2 var(--sans);
}
.campo::placeholder { color: #6A5F92; }

.item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 14px; border-bottom: 1px solid #251D3E;
}
.item:hover { background: #221A3A; }
.item .num { font: 500 10.5px/1 var(--mono); color: var(--dialDim); width: 18px; flex: 0 0 18px; }
.item .txt { flex: 1; min-width: 0; }
.item .t { font: 500 13px/1.3 var(--sans); color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item .s { font: 400 11px/1.3 var(--sans); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item .acao { color: var(--muted); padding: 5px; border-radius: 6px; line-height: 0; }
.item .acao:hover { background: var(--raise); color: var(--text); }
.item .acao.somar { color: var(--dial); }

.recado { padding: 22px 16px; text-align: center; font: 400 12.5px/1.6 var(--sans); color: var(--muted); }

/* ---------- registro ---------- */

.log { padding: 10px 14px 16px; display: flex; flex-direction: column; gap: 7px; }
.evento { display: flex; gap: 9px; font: 400 11.5px/1.5 var(--mono); }
.evento .hora { color: #5C5380; flex: 0 0 auto; }
.evento .txt { color: #BCB2DC; }
.evento.pause_all .txt, .evento.skip_all .txt, .evento.play_all .txt { color: var(--dial); }
.evento.add .txt { color: var(--live); }
.evento.join .txt, .evento.leave .txt, .evento.owner .txt { color: #9B91BD; }
.evento.detach .txt, .evento.attach .txt { color: #746A99; }
.evento.auto .txt { color: #837AA6; font-style: italic; }

/* ---------- reações ---------- */

.reacoes { display: flex; gap: 8px; }
.rebt {
  flex: 1; padding: 8px 6px; border-radius: 9px; font-size: 15px; line-height: 1;
  background: var(--raise); border: 1px solid var(--line);
}
.rebt:hover { border-color: #57459A; background: #322754; }
.rebt.votar { font: 600 12px/1 var(--mono); color: var(--warn); }
.rebt.votar:hover { border-color: var(--warn); }

.flutua {
  position: absolute; bottom: 120px; font-size: 26px; pointer-events: none;
  animation: sobe 2s ease-out forwards; z-index: 5;
}
.flutuaQuem {
  position: absolute; bottom: 104px; pointer-events: none;
  font: 600 10px/1 var(--mono); color: var(--muted);
  animation: sobe 2s ease-out forwards; z-index: 5;
}
@keyframes sobe {
  0%   { transform: translateY(0) scale(.7); opacity: 0; }
  15%  { transform: translateY(-14px) scale(1.05); opacity: 1; }
  100% { transform: translateY(-150px) scale(1); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .flutua, .flutuaQuem { animation: none; opacity: 0; }
}

/* ---------- chat ---------- */

.chatLinha {
  position: sticky; bottom: 0; display: flex; gap: 7px;
  padding: 9px 14px 12px; background: var(--bg); border-top: 1px solid var(--line);
}
.evento.chat .txt { color: var(--text); font-family: var(--sans); font-size: 12.5px; }
.evento.vote .txt { color: var(--warn); }

/* ---------- redimensionar ---------- */

.pegadorL {
  position: absolute; left: 0; top: 0; bottom: 0; width: 8px;
  cursor: ew-resize; z-index: 9;
}
.pegadorT {
  position: absolute; left: 0; right: 0; top: 0; height: 7px;
  cursor: ns-resize; z-index: 9;
}
.pegadorL::after {
  content: ""; position: absolute; left: 2px; top: 50%; transform: translateY(-50%);
  width: 3px; height: 34px; border-radius: 2px; background: var(--line);
}
.pegadorL:hover::after { background: var(--dial); }
.pegadorT:hover { background: linear-gradient(180deg, var(--dialDim), transparent); }

/* ---------- ajustes ---------- */

.bloco { padding: 0 14px 6px; }
.coresGrade { display: grid; grid-template-columns: repeat(10, 1fr); gap: 6px; }
.corBt {
  aspect-ratio: 1; border-radius: 50%; border: 2px solid transparent;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.35);
}
.corBt.ativa { border-color: var(--text); transform: scale(1.12); }
.corPonto { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 9px; }

.opcao {
  display: flex; align-items: center; gap: 12px; cursor: pointer;
  padding: 11px 12px; border-radius: 12px; margin-bottom: 7px;
  background: var(--raise); border: 1px solid var(--line);
}
.opcao:hover { border-color: #57459A; }
.opcaoT { font: 600 13px/1.3 var(--sans); color: var(--text); }
.opcaoD { font: 400 11.5px/1.45 var(--sans); color: var(--muted); margin-top: 2px; }
.chave {
  margin-left: auto; flex: 0 0 40px; width: 40px; height: 23px; border-radius: 999px;
  background: #3B3358; border: 1px solid var(--line); position: relative;
  transition: background .15s;
}
.chave i {
  position: absolute; top: 2px; left: 2px; width: 17px; height: 17px;
  border-radius: 50%; background: var(--muted); transition: left .15s, background .15s;
}
.chave.on { background: var(--dial); border-color: var(--dial); }
.chave.on i { left: 19px; background: #fff; }

/* ---------- aba Sala ---------- */

.salaTit {
  font: 800 10.5px/1 var(--mono); letter-spacing: .16em; text-transform: uppercase;
  color: var(--muted); padding: 13px 14px 7px;
}
.pessoasV { display: flex; flex-direction: column; gap: 6px; padding: 0 14px 4px; }
.pessoaL {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px; border-radius: 12px;
  background: var(--raise); border: 1px solid var(--line);
  font: 500 12.5px/1 var(--sans); color: var(--text);
}
.pessoaL.voce { border-color: var(--dialDim); }
.pessoaL .dono { color: var(--dial); font-size: 11px; }
.pessoaL .st { margin-left: auto; font: 400 10.5px/1 var(--mono); color: var(--muted); }

/* ---------- rodapé ---------- */

.rodape {
  display: flex; align-items: center; gap: 7px;
  padding: 10px 12px; border-top: 1px solid var(--line); background: var(--surface);
}
.rodape .campo { flex: 1; padding: 7px 9px; font-size: 12.5px; }
.emojiBt {
  width: 34px; height: 32px; border-radius: 8px; font-size: 15px;
  background: var(--raise); border: 1px solid var(--line);
}
.emojiGrade {
  position: absolute; bottom: 52px; left: 12px; right: 12px;
  display: grid; grid-template-columns: repeat(8, 1fr); gap: 3px;
  padding: 9px; border-radius: 10px;
  background: var(--raise); border: 1px solid var(--line);
  box-shadow: 0 -8px 24px rgba(0,0,0,.5);
}
.emojiGrade[hidden] { display: none; }
.emojiGrade button { padding: 5px; border-radius: 6px; font-size: 16px; line-height: 1; }
.emojiGrade button:hover { background: #3B2F60; }

/* ---------- entrada ---------- */

.porta { padding: 26px 20px; display: grid; gap: 14px; align-content: start; }
.porta h2 { font: 700 17px/1.3 var(--sans); }
.porta p { font: 400 12.5px/1.6 var(--sans); color: var(--muted); }
.porta .bt.eu { padding: 12px; }
.ou { text-align: center; font: 500 10px/1 var(--mono); letter-spacing: .18em; color: #6A5F92; text-transform: uppercase; }

.torrada {
  position: absolute; left: 14px; right: 14px; bottom: 60px;
  padding: 9px 12px; border-radius: 11px;
  background: var(--warn); color: #2A1108;
  font: 600 12px/1.4 var(--sans);
}
.torrada[hidden] { display: none; }

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}
`;
