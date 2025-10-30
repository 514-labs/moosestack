import { SmallTextEmbed } from "@/components/typography";
import { Button } from "@/components/ui";
import Link from "next/link";

interface ChipProps {
  label: string;
  href: string;
}

export function ChipButton({ label, href }: ChipProps) {
  return (
    <Link href={href}>
      <Button
        variant="outline"
        className="hover:bg-muted cursor-pointer border-muted-foreground"
      >
        <SmallTextEmbed className="px-1.5 py-1 my-0 font-normal text-muted-foreground">
          {label}
        </SmallTextEmbed>
      </Button>
    </Link>
  );
}
