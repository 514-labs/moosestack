import { visit } from "unist-util-visit";

type GuideTypeMarker = "step" | "checkpoint" | "at-a-glance" | "prompt";

interface MdxJsxAttribute {
  type: "mdxJsxAttribute";
  name: string;
  value?: string | null;
}

interface MdxJsxElementNode {
  type: "mdxJsxFlowElement" | "mdxJsxTextElement";
  name?: string | null;
  attributes?: MdxJsxAttribute[];
}

interface MdastRoot {
  type: "root";
  children: unknown[];
}

const GUIDE_STEPPER_TAG_MARKERS: Record<string, GuideTypeMarker> = {
  "GuideStepper.Step": "step",
  "GuideStepper.Checkpoint": "checkpoint",
  "GuideStepper.AtAGlance": "at-a-glance",
  "GuideStepper.Prompt": "prompt",
};

const GUIDE_TYPE_PROP = "__guideType";

/**
 * Adds stable guide-stepper markers at compile time so runtime guards can
 * identify GuideStepper children without relying on fragile component identity
 * checks across MDX/RSC boundaries.
 */
export function remarkGuideStepperMarkers() {
  return (tree: MdastRoot) => {
    visit(tree, ["mdxJsxFlowElement", "mdxJsxTextElement"], (node: unknown) => {
      const element = node as MdxJsxElementNode;
      const elementName = element.name ?? "";
      const marker = GUIDE_STEPPER_TAG_MARKERS[elementName];

      if (!marker) return;

      if (!element.attributes) {
        element.attributes = [];
      }

      const existingMarker = element.attributes.find(
        (attribute) =>
          attribute.type === "mdxJsxAttribute" &&
          attribute.name === GUIDE_TYPE_PROP,
      );

      if (existingMarker) {
        existingMarker.value = marker;
        return;
      }

      element.attributes.push({
        type: "mdxJsxAttribute",
        name: GUIDE_TYPE_PROP,
        value: marker,
      });
    });
  };
}

export default remarkGuideStepperMarkers;
