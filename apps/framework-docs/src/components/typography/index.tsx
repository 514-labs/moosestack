import { Copy } from "lucide-react";
import { forwardRef } from "react";
import { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { type ComponentPropsWithoutRef } from "react";

export const BannerDisplay = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => {
  return (
    <h1
      className={cn(
        "text-primary text-nowrap text-9xl md:text-[20rem] ",
        className,
      )}
    >
      {children}
    </h1>
  );
};

const textBase = "my-5";

export const SuperDisplay = ({
  className,
  children,
}: ComponentPropsWithoutRef<"h1">) => {
  return (
    <h1
      className={cn(
        "text-primary text-3xl xs:text-4xl sm:text-6xl md:text-7xl lg:text-8xl 2xl:text-[10rem] 3xl::text-[10rem]",
        className,
      )}
    >
      {children}
    </h1>
  );
};

export const Display = ({
  className,
  children,
}: ComponentPropsWithoutRef<"h2">) => {
  return (
    <h2
      className={cn(
        "text-primary text-4xl sm:text-6xl 3xl:text-7xl",
        textBase,
        className,
      )}
    >
      {children}
    </h2>
  );
};

export enum HeadingLevel {
  l1 = "text-primary text-3xl sm:text-5xl 3xl:text-6xl",
  l2 = "text-primary text-xl sm:text-3xl 3xl:text-4xl",
  l3 = "text-primary text-lg sm:text-2xl 3xl:text-3xl",
  l4 = "text-primary text-base sm:text-xl 3xl:text-2xl",
  l5 = "text-muted-foreground text-base sm:text-xl 3xl:text-xl",
}

interface HeadingProps extends ComponentPropsWithoutRef<"h3"> {
  level?: HeadingLevel;
  longForm?: boolean; // Is the heading part of a long form text?
}

const longFormHeadingBase = textBase + " mt-10 mb-0";

export const Heading = ({
  className,
  children,
  level = HeadingLevel.l1,
  longForm,
  id,
}: HeadingProps) => {
  return (
    <h3
      className={cn(
        level,
        longForm ? longFormHeadingBase : textBase,
        className,
      )}
      id={id}
    >
      {children}
    </h3>
  );
};
const smallBodyBase =
  "text-primary leading-none 2xl:leading-none text-sm sm:text-sm 2xl:text-base 3xl:text-lg";

export const SmallText = forwardRef<
  HTMLParagraphElement,
  ComponentPropsWithoutRef<"p">
>(({ className, children, ...props }, ref) => {
  return (
    <p
      ref={ref}
      className={cn(smallBodyBase, textBase, className)}
      {...props}
      suppressHydrationWarning
    >
      {children}
    </p>
  );
});

export const SmallTextEmbed = forwardRef<
  HTMLSpanElement,
  ComponentPropsWithoutRef<"span">
>(({ className, children, ...props }, ref) => {
  return (
    <span
      ref={ref}
      className={cn(smallBodyBase, textBase, className)}
      {...props}
      suppressHydrationWarning
    >
      {children}
    </span>
  );
});

export const textBodyBase =
  "text-primary leading-normal 2xl:leading-normal sm:text-lg 2xl:text-xl 3xl:text-2xl";

export const TextEmbed = forwardRef<
  HTMLSpanElement,
  ComponentPropsWithoutRef<"span">
>(({ className, children, ...props }, ref) => {
  // This component is used to embed text in another paragraph component

  return (
    <span
      ref={ref}
      className={cn(textBodyBase, textBase, className)}
      {...props}
    >
      {children}
    </span>
  );
});

interface TextProps extends ComponentPropsWithoutRef<"p"> {
  longForm?: boolean; // Is the text part of a long form text?
}

const longFormTextBase = textBase + " my-5";

export const Text = forwardRef<HTMLParagraphElement, TextProps>(
  ({ className, children, longForm, ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={cn(
          textBodyBase,
          longForm ? longFormTextBase : textBase,
          className,
        )}
        {...props}
      >
        {children}
      </p>
    );
  },
);

export const GradientText = ({
  className,
  gradient,
  children,
}: {
  className?: string;
  gradient?: "moose" | "boreal";
  children: ReactNode;
}) => {
  const gradients = {
    moose: "bg-gradient",
    boreal: "bg-gradientDarkPink",
  };

  return (
    <Text
      className={cn(
        "text-transparent bg-clip-text",
        gradients[gradient as keyof typeof gradients],
        className,
      )}
    >
      {children}
    </Text>
  );
};

export const CodeSnippet = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "text-primary bg-muted rounded-md py-5 px-6 flex flex-row gap-5 cursor-pointer",
        className,
      )}
    >
      <Text className="grow my-0">{children}</Text>
      <div>
        <Copy strokeWidth={3} />
      </div>
    </div>
  );
};
