// ============================================================
// G.K.IO — Aplica ícones SVG em elementos estáticos do index.html
// marcados com data-icon="<nome>" (ver js/icons.js para o catálogo).
// Roda uma vez no carregamento e observa o DOM, já que alguns desses
// botões (ex: gk-call-mute-btn) trocam de estado via textContent em
// outros módulos — nesses casos o próprio módulo (calls.js) já troca
// o ícone diretamente, este script só cobre a marcação inicial do HTML.
// ============================================================
import { iconHtml } from './icons.js';

function applyIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((elNode) => {
    if (elNode.dataset.iconApplied) return;
    const name = elNode.getAttribute('data-icon');
    elNode.insertAdjacentHTML('afterbegin', iconHtml(name));
    elNode.dataset.iconApplied = 'true';
  });
}

applyIcons();
