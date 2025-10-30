import { Icons, PathConfig } from "./ctas";
import { CTACards, CTACard } from "./cta-card";
import { Heading, HeadingLevel } from "./typography";

export function Contact() {
  return (
    <div className="space-y-6">
      Get help, learn, contribute, and stay connected with the Moose community
      <CTACards columns={1}>
        <CTACard
          title="Join Slack"
          description="Connect with developers and get help with your projects"
          ctaLink={PathConfig.slack.path}
          ctaLabel="Join Slack"
          Icon={Icons.slack}
          orientation="horizontal"
        />
        <CTACard
          title="Watch Tutorials"
          description="Video tutorials, demos, and deep-dives into MooseStack features"
          ctaLink={PathConfig.youtube.path}
          ctaLabel="Watch Tutorials"
          Icon={Icons.youtube}
          orientation="horizontal"
        />
        <CTACard
          title="Talk to Us"
          description="Contact the MooseStack maintainers for support and feedback"
          ctaLink={PathConfig.calendly.path}
          ctaLabel="Schedule a Call"
          Icon={Icons.contact}
          orientation="horizontal"
        />
        <CTACard
          title="View GitHub"
          description="Check out the code, contribute to MooseStack, and report issues"
          ctaLink={PathConfig.github.path}
          ctaLabel="Contribute"
          Icon={Icons.github}
          orientation="horizontal"
        />
        <CTACard
          title="Follow on X"
          description="Follow us on X for the latest news and updates"
          ctaLink={PathConfig.twitter.path}
          ctaLabel="Follow Us"
          Icon={Icons.twitter}
          orientation="horizontal"
        />
      </CTACards>
    </div>
  );
}
