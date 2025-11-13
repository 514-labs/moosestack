import type { NavItem, NavPage } from "@/config/navigation";
import {
  getNavigationConfig,
  getSectionFromPathname,
  sectionNavigationConfigs,
} from "@/config/navigation";

export interface DocBreadcrumbItem {
  label: string;
  href?: string;
}

type TrailSegment =
  | {
      kind: "section";
      title: string;
    }
  | {
      kind: "page";
      page: NavPage;
    };

const INDEX_SUFFIX = "/index";

function slugMatches(navSlug: string, targetSlug: string): boolean {
  if (navSlug === targetSlug) {
    return true;
  }

  if (navSlug === `${targetSlug}${INDEX_SUFFIX}`) {
    return true;
  }

  if (targetSlug === `${navSlug}${INDEX_SUFFIX}`) {
    return true;
  }

  if (
    navSlug.endsWith(INDEX_SUFFIX) &&
    navSlug.slice(0, -INDEX_SUFFIX.length) === targetSlug
  ) {
    return true;
  }

  if (
    targetSlug.endsWith(INDEX_SUFFIX) &&
    targetSlug.slice(0, -INDEX_SUFFIX.length) === navSlug
  ) {
    return true;
  }

  return false;
}

function findNavTrail(
  targetSlug: string,
  items: NavItem[],
  trail: TrailSegment[] = [],
): TrailSegment[] | null {
  for (const item of items) {
    if (item.type === "separator") {
      continue;
    }

    if (item.type === "label") {
      continue;
    }

    if (item.type === "section") {
      const sectionTrail: TrailSegment[] = [
        ...trail,
        { kind: "section", title: item.title },
      ];
      const result = findNavTrail(targetSlug, item.items, sectionTrail);
      if (result) {
        return result;
      }
      continue;
    }

    if (item.type === "page") {
      if (slugMatches(item.slug, targetSlug)) {
        return [...trail, { kind: "page", page: item }];
      }

      if (item.children && item.children.length > 0) {
        const pageTrail: TrailSegment[] = [
          ...trail,
          { kind: "page", page: item },
        ];
        const result = findNavTrail(targetSlug, item.children, pageTrail);
        if (result) {
          return result;
        }
      }
    }
  }

  return null;
}

function titleFromSegment(segment: string): string {
  return segment
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function fallbackBreadcrumbs(
  slug: string,
  pageTitle?: string,
): DocBreadcrumbItem[] {
  const segments = slug.split("/").filter(Boolean);
  if (segments.length === 0) {
    return pageTitle ? [{ label: pageTitle }] : [];
  }

  const items: DocBreadcrumbItem[] = [];
  let accumulated = "";

  segments.forEach((segment, index) => {
    accumulated = accumulated ? `${accumulated}/${segment}` : segment;
    const isLast = index === segments.length - 1;
    items.push({
      label: isLast && pageTitle ? pageTitle : titleFromSegment(segment),
      href: isLast ? undefined : `/${accumulated}`,
    });
  });

  return items;
}

export function buildDocBreadcrumbs(
  slug: string,
  pageTitle?: string,
): DocBreadcrumbItem[] {
  const normalizedSlug = slug.replace(/^\/+/, "");
  const pathname = `/${normalizedSlug}`;

  const section = getSectionFromPathname(pathname);
  const firstSegment = normalizedSlug.split("/")[0] ?? "";

  const isRecognizedSection =
    section !== null &&
    (section === "moosestack" ||
      section === "hosting" ||
      section === "ai" ||
      section === "guides" ||
      section === "templates") &&
    firstSegment === section;

  if (!isRecognizedSection) {
    return fallbackBreadcrumbs(normalizedSlug, pageTitle);
  }

  const sectionConfig = sectionNavigationConfigs[section];
  const breadcrumbs: DocBreadcrumbItem[] = [
    {
      label: sectionConfig.title,
      href: `/${section}`,
    },
  ];

  const navConfig = getNavigationConfig(section);
  const trail = findNavTrail(normalizedSlug, navConfig);

  if (!trail) {
    const fallback = fallbackBreadcrumbs(normalizedSlug, pageTitle);
    if (fallback.length === 0) {
      return breadcrumbs;
    }

    const [first, ...rest] = fallback;
    if (
      first &&
      (first.href === `/${section}` || first.label === sectionConfig.title)
    ) {
      return [...breadcrumbs, ...rest];
    }

    return [...breadcrumbs, ...fallback];
  }

  const trailItems: DocBreadcrumbItem[] = trail.map((segment) => {
    if (segment.kind === "section") {
      return { label: segment.title };
    }

    const href = `/${segment.page.slug}`;
    return {
      label: segment.page.title,
      href,
    };
  });

  const combined = [...breadcrumbs, ...trailItems];

  if (combined.length > 0 && pageTitle) {
    const lastIndex = combined.length - 1;
    combined[lastIndex] = {
      ...combined[lastIndex],
      label: pageTitle,
    };
  }

  return combined;
}
