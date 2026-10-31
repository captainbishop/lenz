// Public labels only. Keys, message authentication and balances never depend on them.
export const AVATARS = ['moon', 'wave', 'leaf', 'spark'];
export const PHOTO_LIMIT = 24000;
export function validPhoto(photo) {
  if (typeof photo !== 'string' || photo.length > PHOTO_LIMIT || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)) return false;
  try {
    const raw = atob(photo.slice(23));
    return btoa(raw) === photo.slice(23) && raw.startsWith('\xff\xd8\xff') && raw.endsWith('\xff\xd9');
  } catch { return false; }
}
export function privateName() {
  const first = ['Quiet', 'Silver', 'Moss', 'Blue', 'Soft', 'Amber', 'Cedar', 'Night', 'Still', 'Wild', 'Dawn', 'Cloud', 'River', 'Dune', 'Pine', 'Autumn'];
  const last = ['Finch', 'Otter', 'Fox', 'Owl', 'Wren', 'Heron', 'Moth', 'Robin', 'Lynx', 'Sparrow', 'Hare', 'Crane', 'Swan', 'Lark', 'Deer', 'Kite'];
  const picks = crypto.getRandomValues(new Uint8Array(2));
  return `${first[picks[0] % first.length]} ${last[picks[1] % last.length]}`;
}
const shapes = {
  moon: '<path d="M39 14a19 19 0 1 0 11 30A21 21 0 0 1 39 14Z"/>',
  wave: '<path d="M12 25c10-14 20 14 40 0M12 38c10-14 20 14 40 0"/>',
  leaf: '<path d="M17 46C9 24 28 13 49 15c0 23-10 37-32 31Zm1-1 22-22"/>',
  spark: '<path d="m32 12 5 15 15 5-15 5-5 15-5-15-15-5 15-5Z"/>'
};
export function avatarSource(profile = {}) {
  if (validPhoto(profile.photo)) return profile.photo;
  const shape = shapes[AVATARS.includes(profile.avatar) ? profile.avatar : 'moon'];
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#e1efa6"/><g fill="none" stroke="#173f35" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${shape}</g></svg>`);
}
export function paintAvatar(node, profile) {
  const image = document.createElement('img'); image.src = avatarSource(profile); image.alt = ''; image.width = image.height = 64;
  node.replaceChildren(image);
}
export async function photoFromFile(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG or WebP photo.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a photo smaller than 10 MB.');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f5f5ef'; ctx.fillRect(0, 0, 128, 128);
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 128, 128);
    // Encoding new pixels drops the source file's location and camera metadata.
    const photo = canvas.toDataURL('image/jpeg', 0.8);
    if (!validPhoto(photo)) throw new Error('This photo could not be made small enough. Try a simpler image.');
    return photo;
  } catch (error) {
    if (error.name === 'EncodingError') throw new Error('This photo could not be opened. Choose another image.');
    throw error;
  } finally { URL.revokeObjectURL(url); }
}
