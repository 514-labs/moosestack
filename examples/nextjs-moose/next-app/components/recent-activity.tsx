import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function RecentActivity() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>
          Latest events and updates from your system
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">Event completed</p>
            <p className="text-muted-foreground text-xs">2 minutes ago</p>
          </div>
          <Badge variant="secondary">Completed</Badge>
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">New user registered</p>
            <p className="text-muted-foreground text-xs">15 minutes ago</p>
          </div>
          <Badge variant="default">Active</Badge>
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">System update</p>
            <p className="text-muted-foreground text-xs">1 hour ago</p>
          </div>
          <Badge variant="outline">Info</Badge>
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">Payment processed</p>
            <p className="text-muted-foreground text-xs">2 hours ago</p>
          </div>
          <Badge variant="secondary">Completed</Badge>
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="w-full">
          View All Activity
        </Button>
      </CardFooter>
    </Card>
  );
}
