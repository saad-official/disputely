import { cn } from "@/lib/utils";

/**
 * Section eyebrow written like a case-file tab: a mono index, then a word.
 * It is plain text framing the heading that follows, not a heading itself.
 */
export function SectionLabel({
  index,
  children,
  className,
  onDark = false,
}: {
  index?: string;
  children: React.ReactNode;
  className?: string;
  onDark?: boolean;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-3 font-mono text-xs font-medium tracking-[0.06em] uppercase",
        onDark ? "text-linen/80" : "text-foreground/75",
        className,
      )}
    >
      {index ? (
        <span className={cn("border-r pr-3", onDark ? "border-linen/30" : "border-foreground/25")}>{index}</span>
      ) : null}
      <span>{children}</span>
    </p>
  );
}

export function SectionHeading({
  id,
  label,
  index,
  title,
  intro,
  onDark = false,
  className,
}: {
  id: string;
  label: string;
  index?: string;
  title: React.ReactNode;
  intro?: React.ReactNode;
  onDark?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("max-w-3xl", className)}>
      <SectionLabel index={index} onDark={onDark}>
        {label}
      </SectionLabel>
      <h2 id={`${id}-title`} className="mt-4 text-3xl leading-[1.1] tracking-[-0.035em] text-balance sm:text-4xl lg:text-[2.75rem]">
        {title}
      </h2>
      {intro ? (
        <p
          className={cn(
            "mt-5 max-w-2xl text-lg leading-relaxed text-pretty",
            onDark ? "text-linen/85" : "text-foreground/80",
          )}
        >
          {intro}
        </p>
      ) : null}
    </div>
  );
}
