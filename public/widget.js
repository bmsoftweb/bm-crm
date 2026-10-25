/*
 * Suporte pelo site (BM-CRM). No site do cliente, antes de </body>:
 *   <script src="https://<endereço do CRM>/widget.js" data-empresa="1"></script>
 * Opcional: data-cnpj="12345678000199" (já vem preenchido), data-cor="#2563eb".
 * Mostra um botão flutuante que abre o chat de suporte (página /suporte do CRM) num painel.
 */
(function () {
  if (window.__crmwebSuporte) return;
  window.__crmwebSuporte = true;

  // No Wix (Código personalizado) o script pode ser inserido depois: aí currentScript vem vazio
  var script = document.currentScript || document.querySelector('script[src*="/widget.js"]');
  if (!script) return;
  var origem = new URL(script.src).origin;
  var empresa = script.getAttribute('data-empresa') || '1';
  var cnpj = script.getAttribute('data-cnpj') || '';
  var cor = script.getAttribute('data-cor') || '#2563eb';
  var url = origem + '/suporte?e=' + encodeURIComponent(empresa) + (cnpj ? '&cnpj=' + encodeURIComponent(cnpj) : '');

  // Registra a visita no CRM (Suporte › Visitas do Site), uma vez por aba: navegar pelo site não repete.
  // A chave da aba liga a entrada às saídas. text/plain + no-cors: sem consulta prévia de CORS; a resposta não interessa
  var urlVisitas = origem + '/api/publico/suporte/' + encodeURIComponent(empresa) + '/visitas';
  function enviarVisita(caminho, dados) {
    if (!window.fetch) return;
    fetch(urlVisitas + caminho, {
      method: 'POST',
      mode: 'no-cors',
      keepalive: true,
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(dados),
    }).catch(function () {});
  }
  // Nome e CNPJ que o cliente já informou no chat (o chat avisa o widget; fica guardado neste site)
  var cliente = {};
  try {
    cliente = JSON.parse(localStorage.getItem('crmwebCliente:' + empresa) || '{}') || {};
  } catch (e) {
    // sem localStorage: visita sem nome
  }
  var chaveVisita = null;
  try {
    chaveVisita = sessionStorage.getItem('crmwebVisita:' + empresa);
  } catch (e) {
    // sem sessionStorage (navegação privada bloqueada): cada página vira uma visita
  }
  if (!chaveVisita) {
    chaveVisita = window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    try {
      sessionStorage.setItem('crmwebVisita:' + empresa, chaveVisita);
    } catch (e) {
      // idem
    }
    enviarVisita('', {
      chave: chaveVisita,
      pagina: location.href,
      titulo: document.title,
      origem: document.referrer,
      cnpj: cnpj || cliente.documento || '',
      nome: cliente.nome || '',
    });
  }
  // Saída: página fora de vista (fechou a aba, foi para outro site, trocou de aba ou de página do site). A última vale
  function registrarSaida() {
    if (navigator.sendBeacon) navigator.sendBeacon(urlVisitas + '/saida', new Blob([JSON.stringify({ chave: chaveVisita })], { type: 'text/plain' }));
    else enviarVisita('/saida', { chave: chaveVisita });
  }
  // Ainda no site: a cada minuto com a página à vista (e ao voltar para ela), para o CRM mostrar "Visitando..."
  function registrarPresenca() {
    if (document.visibilityState === 'visible') enviarVisita('/presente', { chave: chaveVisita });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') registrarSaida();
    else registrarPresenca();
  });
  window.addEventListener('pagehide', registrarSaida);
  setInterval(registrarPresenca, 60000);
  setTimeout(registrarPresenca, 3000);

  var caixa = document.createElement('div');
  caixa.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483000;font-family:system-ui,sans-serif;';

  var painel = document.createElement('div');
  painel.style.cssText =
    'display:none;width:380px;height:650px;max-width:calc(100vw - 40px);max-height:calc(100vh - 110px);margin-bottom:14px;' +
    'border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.25);background:#fff;';
  var quadro = null; // o chat só carrega na primeira abertura

  // Texto ao lado do ícone com o chat fechado. Temporário, para divulgar o suporte novo: '' volta ao botão redondo
  var ROTULO = '';

  var botao = document.createElement('button');
  botao.type = 'button';
  botao.setAttribute('aria-label', 'Suporte');
  botao.style.cssText =
    'display:flex;align-items:center;justify-content:center;gap:10px;margin-left:auto;height:60px;border:0;border-radius:30px;' +
    'font:700 14px/1 system-ui,sans-serif;letter-spacing:.04em;white-space:nowrap;' +
    'cursor:pointer;color:#fff;background:' + cor + ';box-shadow:0 8px 24px rgba(0,0,0,.25);';
  var iconeChat =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var iconeFechar =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  /** Fechado: ícone + texto (pílula); aberto: só o X (círculo) */
  function desenharBotao(aberto) {
    var comTexto = !aberto && ROTULO;
    botao.innerHTML = aberto ? iconeFechar : iconeChat + (comTexto ? '<span>' + ROTULO + '</span>' : '');
    botao.style.width = comTexto ? 'auto' : '60px';
    botao.style.padding = comTexto ? '0 22px 0 18px' : '0';
  }
  desenharBotao(false);

  // ev vazio = aberto pelo aviso do chat (sem clique: aí não dá para pedir a permissão de notificação)
  botao.onclick = function (ev) {
    var abrir = painel.style.display === 'none';
    if (abrir && ev) pedirPermissao();
    if (abrir && !quadro) {
      quadro = document.createElement('iframe');
      quadro.src = url;
      quadro.title = 'Suporte';
      quadro.style.cssText = 'width:100%;height:100%;border:0;';
      painel.appendChild(quadro);
    }
    painel.style.display = abrir ? 'block' : 'none';
    desenharBotao(abrir);
  };

  // Título da aba piscando enquanto o cliente não volta para a página
  var tituloOriginal = null;
  var pisca = null;
  function pararTitulo() {
    if (!pisca) return;
    clearInterval(pisca);
    pisca = null;
    document.title = tituloOriginal;
  }
  function piscarTitulo(aviso) {
    if (pisca) return;
    tituloOriginal = document.title;
    var vez = 0;
    pisca = setInterval(function () {
      document.title = vez++ % 2 ? tituloOriginal : aviso;
    }, 1000);
  }
  window.addEventListener('focus', pararTitulo);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) pararTitulo();
  });

  // Notificação do Windows: o navegador não deixa a página se pôr na frente, mas o clique na notificação traz a janela.
  // Pede a permissão no clique do botão (só funciona em site https)
  var podeNotificar = 'Notification' in window && window.isSecureContext;
  function pedirPermissao() {
    if (podeNotificar && Notification.permission === 'default') {
      try {
        Notification.requestPermission();
      } catch (e) {
        // navegador antigo
      }
    }
  }
  // Sem "tag": com ela, a notificação nova só substitui a anterior em silêncio (não aparece de novo na tela).
  // A anterior é fechada, para não acumular uma por mensagem
  var ultimaNotificacao = null;
  function notificar(titulo, texto) {
    if (!podeNotificar || Notification.permission !== 'granted') return;
    try {
      if (ultimaNotificacao) ultimaNotificacao.close();
      var n = new Notification(titulo, { body: texto });
      ultimaNotificacao = n;
      n.onclick = function () {
        window.focus();
        abrirPainel();
        n.close();
      };
    } catch (e) {
      // Android: notificação só por service worker; fica o som e o título
    }
  }

  function abrirPainel() {
    if (painel.style.display === 'none') botao.onclick();
  }

  function tremer() {
    if (!botao.animate) return;
    botao.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
      { duration: 300, iterations: 4 }
    );
  }

  // Chamar a atenção ao aparecer: treme logo depois de mostrar e mais 2 vezes a cada 15 s, enquanto o chat não
  // for aberto. Quem pediu ao sistema menos animação não vê tremida
  var reduzir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduzir) {
    var vezes = 0;
    var chamar = function () {
      if (quadro || vezes >= 3) return; // já abriu o chat (ou já tremeu o bastante)
      vezes++;
      tremer();
      setTimeout(chamar, 15000);
    };
    setTimeout(chamar, 1500);
  }

  // O chat avisa por postMessage quando a equipe escreve ou cutuca: o painel abre sozinho e, com a página fora de
  // vista (outra aba, janela minimizada ou atrás de outro programa), o título pisca e sai a notificação
  window.addEventListener('message', function (e) {
    if (e.origin !== origem || !e.data || !e.data.crmweb) return;
    // O chat sabe quem é o cliente (dados salvos ou chamado aberto): dá nome a esta visita e às próximas
    if (e.data.crmweb === 'cliente') {
      cliente = { nome: String(e.data.nome || '').slice(0, 120), documento: String(e.data.documento || '').slice(0, 14) };
      try {
        localStorage.setItem('crmwebCliente:' + empresa, JSON.stringify(cliente));
      } catch (err) {
        // sem localStorage: vale só para esta visita
      }
      enviarVisita('/cliente', { chave: chaveVisita, nome: cliente.nome, cnpj: cnpj || cliente.documento });
      return;
    }
    var cutucou = e.data.crmweb === 'cutucar';
    abrirPainel();
    if (cutucou) tremer();
    if (document.hidden || !document.hasFocus()) {
      piscarTitulo(cutucou ? '🔔 O técnico precisa de sua atenção' : '💬 Nova mensagem do suporte');
      notificar('Suporte: ' + (e.data.de || 'nova mensagem'), e.data.texto || '');
    }
  });

  caixa.appendChild(painel);
  caixa.appendChild(botao);
  // Script colocado no <head>: espera a página ter corpo
  if (document.body) document.body.appendChild(caixa);
  else document.addEventListener('DOMContentLoaded', function () {
    document.body.appendChild(caixa);
  });
})();
