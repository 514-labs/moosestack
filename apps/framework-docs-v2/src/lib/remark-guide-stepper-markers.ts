import { visit } from "unist-util-visit";

export const GUIDE_TYPE_PROP = "__guideType";

export const GUIDE_STEPPER_STEP_MARKER = "step";
export const GUIDE_STEPPER_CHECKPOINT_MARKER = "checkpoint";
export const GUIDE_STEPPER_AT_A_GLANCE_MARKER = "at-a-glance";
export const GUIDE_STEPPER_PROMPT_MARKER = "prompt";

export type GuideStepperMarker =
  | typeof GUIDE_STEPPER_STEP_MARKER
  | typeof GUIDE_STEPPER_CHECKPOINT_MARKER
  | typeof GUIDE_STEPPER_AT_A_GLANCE_MARKER
  | typeof GUIDE_STEPPER_PROMPT_MARKER;

export const GUIDE_STEPPER_TAG_MARKERS: Record<string, GuideStepperMarker> = {
  "GuideStepper.Step": GUIDE_STEPPER_STEP_MARKER,
  "GuideStepper.Checkpoint": GUIDE_STEPPER_CHECKPOINT_MARKER,
  "GuideStepper.AtAGlance": GUIDE_STEPPER_AT_A_GLANCE_MARKER,
  "GuideStepper.Prompt": GUIDE_STEPPER_PROMPT_MARKER,
};

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
