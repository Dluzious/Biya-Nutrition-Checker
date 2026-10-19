// Foto dari kamera iPhone bisa >5 MB. Perkecil dulu supaya cepat diunggah dan
// tetap di bawah batas ukuran gambar API (sisi terpanjang ~1568 px sudah cukup
// untuk membaca tabel gizi).

const MAX_EDGE = 1568;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Foto tidak bisa dibuka. Coba ambil ulang atau pilih format JPG/PNG."));
    };
    img.src = url;
  });
}

export interface PreparedImage {
  mediaType: "image/jpeg";
  data: string;
  previewUrl: string;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser tidak mendukung pengolahan foto.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1), previewUrl: dataUrl };
}
