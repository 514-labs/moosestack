"use client";

import {
  IconChartLine,
  IconMessageChatbot,
  IconFileReport,
  IconCloudUpload,
  IconDatabaseImport,
  IconChartDots,
  IconBolt,
  IconUsers,
  IconChartBarOff,
  IconChartBar,
  IconStack,
  IconRoute,
  IconCode,
  IconTrendingUp,
  IconBrain,
  IconDatabase,
  IconServer,
  IconRocket,
  type IconProps,
} from "@tabler/icons-react";

/**
 * Map of icon names to their components for client-side lookup
 */
export const guideIconMap: Record<string, React.ComponentType<IconProps>> = {
  IconChartLine,
  IconMessageChatbot,
  IconFileReport,
  IconCloudUpload,
  IconDatabaseImport,
  IconChartDots,
  IconBolt,
  IconUsers,
  IconChartBarOff,
  IconChartBar,
  IconStack,
  IconRoute,
  IconCode,
  IconTrendingUp,
  IconBrain,
  IconDatabase,
  IconServer,
  IconRocket,
};

export function getGuideIcon(
  iconName?: string,
): React.ComponentType<IconProps> | undefined {
  if (!iconName) return undefined;
  return guideIconMap[iconName];
}
