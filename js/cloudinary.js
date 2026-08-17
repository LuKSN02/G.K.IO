// ============================================================
// G.K.IO — Upload de mídia via Cloudinary
// Usa o endpoint de "unsigned upload" — o arquivo vai direto do
// navegador para o Cloudinary, sem precisar de backend próprio.
// ============================================================
import { cloudinaryConfig } from './cloudinary-config.js';

/**
 * Envia um arquivo para o Cloudinary e retorna { url, resourceType }.
 * @param {File} file
 * @param {string} folder - pasta lógica dentro do Cloudinary (ex: 'avatars', 'attachments')
 */
export async function uploadToCloudinary(file, folder = 'gkio') {
  const { cloudName, uploadPreset } = cloudinaryConfig;

  if (!cloudName || cloudName.startsWith('COLE_AQUI')) {
    throw new Error('Cloudinary não configurado — preencha js/cloudinary-config.js.');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', uploadPreset);
  formData.append('folder', folder);

  // "auto" detecta automaticamente se é imagem, vídeo ou arquivo genérico (raw).
  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;

  const res = await fetch(endpoint, { method: 'POST', body: formData });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || 'Falha no upload para o Cloudinary.');
  }
  const data = await res.json();
  return {
    url: data.secure_url,
    resourceType: data.resource_type, // 'image' | 'video' | 'raw'
    format: data.format,
  };
}
