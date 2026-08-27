'use client';

/**
 * Превʼю Office через публічний вьювер Microsoft.
 *
 * КОМПРОМІС, ПОГОДЖЕНИЙ ІЗ КОРИСТУВАЧЕМ (спека §6.4): URL документа їде на
 * сервери Microsoft, і Microsoft його завантажує. Cloudinary-URL-и не
 * авторизовані — хто має URL, той має файл. Залишено заради паритету: портал
 * робить рівно це з тими самими файлами.
 *
 * pointer-events вимкнено — це мініатюра, клік обробляє батько.
 */
export default function OfficeThumb({ url, title }) {
  return (
    <div className="w-full h-[160px] bg-surface relative overflow-hidden select-none pointer-events-none">
      <iframe
        src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
        className="w-[200%] h-[400px] origin-top-left scale-[0.5] border-0"
        title={title}
        loading="lazy"
      />
      <div className="absolute inset-0 z-10 bg-transparent" />
    </div>
  );
}
