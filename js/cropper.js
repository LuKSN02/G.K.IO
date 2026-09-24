// ============================================================
// G.K.IO — Recorte de imagem (avatar/banner)
// ============================================================
// Antes, a imagem escolhida ia direto pro Cloudinary sem nenhum
// controle — quem manda uma foto com proporção diferente da área de
// destino simplesmente via um recorte automático (CSS object-fit),
// sem poder escolher qual pedaço aparece. Esse módulo abre um recorte
// de verdade: arrasta pra reposicionar, um slider pra zoom, e só
// exporta o pedaço realmente visível.
//
// openImageCropper(file, aspect) retorna uma Promise<File|null> — File
// (não Blob puro) pra continuar se comportando como o que
// uploadProfileImage() já espera; null se a pessoa cancelar.
// ============================================================
import { el } from './state.js';

export function openImageCropper(file, aspect, { title = 'Ajustar imagem', outputWidth = 512 } = {}) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    // Viewport do recorte na tela — o tamanho de exportação é
    // independente disso (outputWidth), então a proporção é o que
    // importa aqui, não os pixels exatos.
    const viewportW = 320;
    const viewportH = Math.round(viewportW / aspect);

    let scale = 1;     // 1 = a imagem cobre exatamente o viewport pelo lado menor
    let minScale = 1;
    let offsetX = 0;   // deslocamento em px de tela, dentro do viewport
    let offsetY = 0;

    const canvas = el('canvas', { width: viewportW, height: viewportH, class: 'gk-cropper-canvas' });
    const ctx = canvas.getContext('2d');

    function draw() {
      ctx.clearRect(0, 0, viewportW, viewportH);
      const drawW = img.naturalWidth * scale;
      const drawH = img.naturalHeight * scale;
      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
    }

    function clampOffset() {
      const drawW = img.naturalWidth * scale;
      const drawH = img.naturalHeight * scale;
      offsetX = Math.min(0, Math.max(offsetX, viewportW - drawW));
      offsetY = Math.min(0, Math.max(offsetY, viewportH - drawH));
    }

    img.onload = () => {
      // minScale cobre o viewport inteiro sem sobrar borda vazia —
      // mesma lógica de um background-size:cover.
      minScale = Math.max(viewportW / img.naturalWidth, viewportH / img.naturalHeight);
      scale = minScale;
      offsetX = (viewportW - img.naturalWidth * scale) / 2;
      offsetY = (viewportH - img.naturalHeight * scale) / 2;
      zoomSlider.min = String(minScale);
      zoomSlider.max = String(minScale * 3);
      zoomSlider.step = String((minScale * 3 - minScale) / 100 || 0.001);
      zoomSlider.value = String(scale);
      draw();
    };
    img.src = objectUrl;

    // ---------- Arrastar pra reposicionar ----------
    let dragging = false, lastX = 0, lastY = 0;
    const startDrag = (x, y) => { dragging = true; lastX = x; lastY = y; };
    const moveDrag = (x, y) => {
      if (!dragging) return;
      offsetX += x - lastX; offsetY += y - lastY;
      lastX = x; lastY = y;
      clampOffset(); draw();
    };
    const endDrag = () => { dragging = false; };

    canvas.addEventListener('mousedown', (e) => startDrag(e.offsetX, e.offsetY));
    canvas.addEventListener('mousemove', (e) => moveDrag(e.offsetX, e.offsetY));
    window.addEventListener('mouseup', endDrag);
    canvas.addEventListener('touchstart', (e) => { const t = e.touches[0]; startDrag(t.clientX, t.clientY); }, { passive: true });
    canvas.addEventListener('touchmove', (e) => { const t = e.touches[0]; moveDrag(t.clientX, t.clientY); }, { passive: true });
    canvas.addEventListener('touchend', endDrag);

    const zoomSlider = el('input', { type: 'range', class: 'gk-cropper-zoom' });
    zoomSlider.addEventListener('input', () => {
      const prevScale = scale;
      scale = parseFloat(zoomSlider.value);
      // Mantém o centro do viewport fixo enquanto o zoom muda, em vez de
      // recentralizar do zero (senão a pessoa perde o enquadramento que já tinha feito).
      const cx = viewportW / 2, cy = viewportH / 2;
      offsetX = cx - ((cx - offsetX) / prevScale) * scale;
      offsetY = cy - ((cy - offsetY) / prevScale) * scale;
      clampOffset(); draw();
    });

    const overlay = el('div', { class: 'gk-overlay gk-open' });
    const modal = el('div', { class: 'gk-modal gk-cropper-modal' }, [
      el('h2', {}, title),
      el('div', { class: 'gk-cropper-stage', style: `width:${viewportW}px;height:${viewportH}px;` }, [canvas]),
      el('div', { class: 'gk-cropper-zoom-row' }, [
        el('span', { class: 'gk-inline-icon' }, '−'),
        zoomSlider,
        el('span', { class: 'gk-inline-icon' }, '+'),
      ]),
      el('div', { class: 'gk-modal-actions' }, [
        el('button', {
          class: 'gk-btn gk-btn-ghost',
          onclick: () => { cleanup(); resolve(null); },
        }, 'Cancelar'),
        el('button', {
          class: 'gk-btn gk-btn-primary',
          onclick: () => {
            const outH = Math.round(outputWidth / aspect);
            const out = document.createElement('canvas');
            out.width = outputWidth; out.height = outH;
            const octx = out.getContext('2d');
            const factor = outputWidth / viewportW;
            octx.drawImage(img, offsetX * factor, offsetY * factor, img.naturalWidth * scale * factor, img.naturalHeight * scale * factor);
            out.toBlob((blob) => {
              cleanup();
              if (!blob) { resolve(null); return; }
              resolve(new File([blob], file.name || 'imagem.jpg', { type: 'image/jpeg' }));
            }, 'image/jpeg', 0.92);
          },
        }, 'Aplicar'),
      ]),
    ]);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function cleanup() {
      URL.revokeObjectURL(objectUrl);
      overlay.remove();
    }
  });
}
