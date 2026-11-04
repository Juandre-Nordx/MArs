import type { ImgHTMLAttributes } from 'react';
export function placeholderArt(kind: 'resource' | 'building') {
  const body =
    kind === 'resource'
      ? '<path d="m26 68 18-32 37-13 29 45-24 31-39-3Z" fill="#ad715b" stroke="#e7b785" stroke-width="3"/><path d="m44 36 17 29 20-42M61 65l25 34M61 65l-35 3" fill="none" stroke="#f6d6a3" stroke-width="3"/>'
      : '<path d="m12 77 52-26 52 26-52 26Z" fill="#25363d"/><path d="m27 47 37-19 37 19-37 19Z" fill="#a6dbd5"/><path d="m27 47 37 19v31L27 78Z" fill="#468c98"/><path d="m64 66 37-19v31L64 97Z" fill="#2e606f"/><path d="m72 70 20-10v11L72 81Z" fill="#def4e5"/><path d="m38 61 16 8v15l-16-8Z" fill="#152c3b"/>';
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">${body}</svg>`)}`;
}
export function assetUrl(
  ref: string,
  kind: 'resource' | 'building',
  admin = false,
) {
  return ref.startsWith('placeholder:')
    ? placeholderArt(kind)
    : `/api/${admin ? 'admin/assets' : 'catalogue-assets'}/${ref}`;
}
export function CatalogueArt({
  reference,
  kind,
  admin = false,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  reference: string;
  kind: 'resource' | 'building';
  admin?: boolean;
}) {
  return (
    <img
      {...props}
      src={assetUrl(reference, kind, admin)}
      onError={(e) => {
        e.currentTarget.src = placeholderArt(kind);
        e.currentTarget.title =
          'Artwork unavailable; original placeholder shown';
      }}
    />
  );
}
