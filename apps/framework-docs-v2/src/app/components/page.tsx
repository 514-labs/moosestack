"use client";

import { useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Callout,
  CTACard,
  CTACards,
  IconBadge,
  StaggeredCard,
  StaggeredCards,
  StaggeredContent,
  LanguageTabs,
  LanguageTabContent,
  CodeSnippet,
  CodeEditorWrapper,
  ToggleBlock,
  BulletPointsCard,
  CompareBulletPointsCard,
  ArgTable,
  ZoomImg,
  FeatureCard,
  FeatureGrid,
} from "@/components/mdx";
import {
  Snippet,
  SnippetCopyButton,
  SnippetHeader,
  SnippetTabsContent,
  SnippetTabsList,
  SnippetTabsTrigger,
} from "@/components/ui/snippet";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { IconDatabase, IconCode } from "@tabler/icons-react";

function MultiTabSnippet() {
  const [value, setValue] = useState("bash");
  const code = value === "bash" ? "pnpm dev" : "npm run dev";

  return (
    <Snippet value={value} onValueChange={setValue}>
      <SnippetHeader>
        <SnippetTabsList>
          <SnippetTabsTrigger value="bash">Bash</SnippetTabsTrigger>
          <SnippetTabsTrigger value="npm">npm</SnippetTabsTrigger>
        </SnippetTabsList>
        <SnippetCopyButton value={code} />
      </SnippetHeader>
      <SnippetTabsContent value="bash">pnpm dev</SnippetTabsContent>
      <SnippetTabsContent value="npm">npm run dev</SnippetTabsContent>
    </Snippet>
  );
}

export default function ComponentsPage() {
  return (
    <div className="container mx-auto py-12 px-4 max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-4xl font-bold mb-2">Component Testing</h1>
          <p className="text-muted-foreground">
            Test and iterate on all documentation components
          </p>
        </div>
        <ThemeToggle />
      </div>

      <Separator className="my-8" />

      {/* Code Display Components */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-6">Code Display Components</h2>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Snippet Component (Shell Commands)</CardTitle>
            <CardDescription>
              For editable, copyable shell commands and terminal output
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Snippet defaultValue="bash">
              <SnippetHeader>
                <SnippetTabsList>
                  <SnippetTabsTrigger value="bash">Bash</SnippetTabsTrigger>
                </SnippetTabsList>
                <SnippetCopyButton value="npm install" />
              </SnippetHeader>
              <SnippetTabsContent value="bash">npm install</SnippetTabsContent>
            </Snippet>

            <MultiTabSnippet />
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>CodeEditor (Animated IDE/Terminal)</CardTitle>
            <CardDescription>
              Non-editable animated code displays using shadcn.io CodeEditor
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">
                IDE Style (with filename) - Scroll to animate:
              </p>
              <CodeEditorWrapper
                code={`export function MyComponent() {
  return <div>Hello World</div>;
}`}
                language="tsx"
                filename="components/MyComponent.tsx"
                variant="ide"
              />
            </div>
            <div>
              <p className="text-sm font-medium mb-2">
                Terminal Style (Animated) - Scroll to animate:
              </p>
              <CodeEditorWrapper
                code={`npm install
npm run dev
echo "Setup complete!"`}
                language="bash"
                filename="Terminal"
                variant="terminal"
                writing={true}
                duration={3}
                delay={0.3}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>CodeSnippet (Editable Code Blocks)</CardTitle>
            <CardDescription>
              Editable code blocks with copy button and syntax highlighting
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Basic CodeSnippet:</p>
              <CodeSnippet
                code={`const greeting = "Hello, World!";
console.log(greeting);`}
                language="typescript"
              />
            </div>
            <div>
              <p className="text-sm font-medium mb-2">With filename:</p>
              <CodeSnippet
                code={`export default function Page() {
  return <h1>Welcome</h1>;
}`}
                language="tsx"
                filename="app/page.tsx"
              />
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Python example:</p>
              <CodeSnippet
                code={`def greet(name):
    return f"Hello, {name}!"

print(greet("World"))`}
                language="python"
              />
            </div>
          </CardContent>
        </Card>
      </section>

      <Separator className="my-8" />

      {/* Content Components */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-6">Content Components</h2>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Callout</CardTitle>
            <CardDescription>Alert and informational callouts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Callout type="info">
              This is an info callout with helpful information
            </Callout>
            <Callout type="success">
              This is a success callout celebrating an achievement
            </Callout>
            <Callout type="warning">
              This is a warning callout about potential issues
            </Callout>
            <Callout type="danger">
              This is a danger callout for critical errors
            </Callout>
            <Callout type="info" compact>
              This is a compact callout
            </Callout>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>CTACard & CTACards</CardTitle>
            <CardDescription>
              Call-to-action cards in grid layouts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CTACards columns={2}>
              <CTACard
                title="Getting Started"
                description="Learn how to build with MooseStack"
                ctaLink="/moosestack/getting-started"
                ctaLabel="Get Started"
                badge={{ variant: "moose", text: "New" }}
              />
              <CTACard
                title="API Reference"
                description="Browse the complete API documentation"
                ctaLink="/moosestack/reference"
                ctaLabel="View Docs"
                Icon={IconCode}
              />
            </CTACards>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>IconBadge</CardTitle>
            <CardDescription>
              Badges with icons for highlighting features
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <IconBadge variant="moose" label="Moose Module" />
            <IconBadge variant="sloan" label="Sloan Feature" />
            <IconBadge variant="boreal" label="Boreal Hosting" />
            <IconBadge variant="default" label="Default Badge" />
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>StaggeredCard & StaggeredContent</CardTitle>
            <CardDescription>
              Staggered layout cards for feature showcases
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StaggeredCards>
              <StaggeredCard stagger="left">
                <StaggeredContent
                  title="Feature Title"
                  description="Feature description goes here"
                  cta={{ label: "Learn More", href: "#" }}
                />
                <StaggeredContent
                  isMooseModule
                  title="Moose Module"
                  description="A moose module feature"
                  cta={{ label: "View Docs", href: "#" }}
                />
              </StaggeredCard>
            </StaggeredCards>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>LanguageTabs</CardTitle>
            <CardDescription>
              Tabbed content for language-specific examples
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LanguageTabs>
              <LanguageTabContent value="typescript">
                <pre className="p-4 bg-muted rounded-lg">
                  <code>const example = "TypeScript code here";</code>
                </pre>
              </LanguageTabContent>
              <LanguageTabContent value="python">
                <pre className="p-4 bg-muted rounded-lg">
                  <code>example = "Python code here"</code>
                </pre>
              </LanguageTabContent>
            </LanguageTabs>
          </CardContent>
        </Card>
      </section>

      <Separator className="my-8" />

      {/* Utility Components */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-6">Utility Components</h2>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>ToggleBlock</CardTitle>
            <CardDescription>Collapsible content blocks</CardDescription>
          </CardHeader>
          <CardContent>
            <ToggleBlock openText="Show details" closeText="Hide details">
              <p className="text-sm text-muted-foreground">
                This is the collapsible content that can be shown or hidden by
                clicking the toggle button.
              </p>
            </ToggleBlock>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>BulletPointsCard</CardTitle>
            <CardDescription>
              Card with bullet points in various styles
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Default style:</p>
              <BulletPointsCard
                title="Features"
                bullets={["Feature one", "Feature two", "Feature three"]}
                bulletStyle="default"
              />
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Check style:</p>
              <BulletPointsCard
                title="Benefits"
                bullets={[
                  { title: "Fast", description: "Lightning fast performance" },
                  { title: "Secure", description: "Enterprise-grade security" },
                ]}
                bulletStyle="check"
                compact
              />
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Numbered style:</p>
              <BulletPointsCard
                title="Steps"
                bullets={["First step", "Second step", "Third step"]}
                bulletStyle="number"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>ArgTable</CardTitle>
            <CardDescription>
              Table for displaying function/API arguments
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ArgTable
              heading="Parameters"
              args={[
                {
                  name: "name",
                  required: true,
                  description: "The name of the user",
                  examples: ["string"],
                },
                {
                  name: "email",
                  required: false,
                  description: "The email address",
                  examples: ["string"],
                },
              ]}
            />
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>ZoomImg</CardTitle>
            <CardDescription>
              Zoomable images with dark/light mode support
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Click to zoom. Note: Requires light and dark mode image paths.
            </p>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>FeatureCard & FeatureGrid</CardTitle>
            <CardDescription>Feature cards in a grid layout</CardDescription>
          </CardHeader>
          <CardContent>
            <FeatureGrid columns={2}>
              <FeatureCard
                Icon={IconDatabase}
                title="Database"
                description="Connect to your database"
              />
              <FeatureCard
                Icon={IconCode}
                title="API"
                description="Build REST APIs"
              />
            </FeatureGrid>
          </CardContent>
        </Card>
      </section>

      {/* Migration Status */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-6">Migration Status</h2>
        <Card>
          <CardHeader>
            <CardTitle>Component Migration Progress</CardTitle>
            <CardDescription>
              Track which components have been migrated and standardized
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>Callout - Migrated and standardized</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>CTACard/CTACards - Migrated and standardized</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>IconBadge - Migrated and standardized</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>StaggeredCard - Migrated and standardized</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>LanguageTabs - Migrated and standardized</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>Snippet - Migrated and standardized</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>CodeEditor - Migrated and standardized</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>CodeSnippet - Migrated and standardized</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>ToggleBlock - Migrated and standardized</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>BulletPointsCard - Migrated and standardized</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>ArgTable - Migrated and standardized</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>ZoomImg - Migrated and standardized</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>FeatureCard/FeatureGrid - Migrated and standardized</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
