import localFont from "next/font/local";
import { LanguageProvider } from "./LanguageContext";
import { LanguageSwitcher } from "./language-switcher";
// Font files can be colocated inside of `app`
const monoFont = localFont({
  src: "../ABCMonumentGroteskMonoVariable.woff2",
  display: "swap",
  variable: "--font-grotesk-mono",
});

const sansFont = localFont({
  src: "../ABCMonumentGroteskVariable.woff2",
  display: "swap",
  variable: "--font-grotesk",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LanguageProvider>
      <main
        lang="en"
        className={
          "font-sans" +
          ` ${monoFont.variable} ${sansFont.variable} bg-background`
        }
      >
        {children}
      </main>
    </LanguageProvider>
  );
}
