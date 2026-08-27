import Surface from '@/components/ui/Surface';

// Each contract has its own address and reads as a plain document. The shared
// component controls only the measure and type scale; it adds no navigation or
// legal metadata beyond what the document itself says.
export default function LegalDocumentPage({ document }) {
  return (
    <Surface preset="card" padding="xl" className="w-full">
      <article aria-label={document.title} className="max-w-[680px]">
        <h1 className="ui-type-page-title text-ink">{document.title}</h1>
        <p className="mt-[10px] text-[14px] leading-[1.7] text-ink/70">{document.summary}</p>

        <div className="mt-[32px] flex flex-col gap-[32px]">
          {document.sections.map(section => (
            <section key={section.id}>
              <h2 className="ui-type-section-title text-ink">{section.title}</h2>
              <div className="mt-[12px] flex flex-col gap-[12px] text-[14px] leading-[1.8] text-ink/75">
                {(section.paragraphs || []).map(text => <p key={text}>{text}</p>)}
                {section.bullets?.length > 0 && (
                  <ul className="flex list-disc flex-col gap-[8px] pl-[20px] marker:text-muted">
                    {section.bullets.map(item => <li key={item}>{item}</li>)}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>
      </article>
    </Surface>
  );
}
