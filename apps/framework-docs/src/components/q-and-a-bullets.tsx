import { SmallText } from "@/components/typography";

export function QnABullets({
  title,
  bullets,
}: {
  title: string;
  bullets: { title: string; description: string }[];
}) {
  return (
    <ul className="my-5 ml-4">
      {bullets.map((bullet) => (
        <li key={bullet.title}>
          <p>
            <span className="font-semibold italic">{bullet.title + " "}</span>
            <span className="text-muted-foreground">{bullet.description}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

export function CheckmarkBullets({
  title,
  bullets,
  variant = "default",
}: {
  title: string;
  bullets: string[];
  variant?: "default" | "negative";
}) {
  return (
    <>
      <SmallText className="font-semibold">{title}</SmallText>
      <ul className="my-5 ml-4">
        {bullets.map((bullet) => (
          <li key={bullet}>
            {variant === "default" ? "✅" : "❌"} {bullet + " "}
          </li>
        ))}
      </ul>
    </>
  );
}
