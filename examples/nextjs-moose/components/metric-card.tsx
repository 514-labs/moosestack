import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string;
  description?: string;
  icon?: LucideIcon;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  className?: string;
}

export function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  className,
}: MetricCardProps) {
  return (
    <Card className={cn("relative overflow-hidden", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription className="text-sm font-medium">
          {title}
        </CardDescription>
        {Icon && (
          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
        {trend && (
          <div className="flex items-center pt-4">
            {trend.isPositive ?
              <TrendingUp className="h-4 w-4 mr-1 text-green-600 dark:text-green-400" />
            : <TrendingDown className="h-4 w-4 mr-1 text-red-600 dark:text-red-400" />
            }
            <span
              className={cn(
                "text-sm font-semibold",
                trend.isPositive ?
                  "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400",
              )}
            >
              {trend.value}
            </span>
            <span className="text-xs text-muted-foreground ml-2">
              from last month
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
