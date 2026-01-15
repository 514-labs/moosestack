"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const topProducts = [
  {
    sku: "SKU-ELE-00012",
    name: "TechPro Wireless Headphones",
    category: "Electronics",
    revenue: 24500,
    units: 245,
    trend: "up",
  },
  {
    sku: "SKU-CLO-00034",
    name: "StyleMax Winter Jacket",
    category: "Clothing",
    revenue: 18900,
    units: 189,
    trend: "up",
  },
  {
    sku: "SKU-ELE-00008",
    name: "GadgetWorld Smart Watch",
    category: "Electronics",
    revenue: 15600,
    units: 130,
    trend: "down",
  },
  {
    sku: "SKU-HOM-00021",
    name: "CozyHome Throw Blanket",
    category: "Home",
    revenue: 12400,
    units: 310,
    trend: "up",
  },
  {
    sku: "SKU-BEA-00015",
    name: "NaturalBeauty Skincare Set",
    category: "Beauty",
    revenue: 11200,
    units: 160,
    trend: "neutral",
  },
];

export function TopProducts() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Products</CardTitle>
        <CardDescription>Best performing products this month</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Trend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topProducts.map((product) => (
              <TableRow key={product.sku}>
                <TableCell className="font-medium">{product.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{product.category}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  ${product.revenue.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">{product.units}</TableCell>
                <TableCell className="text-right">
                  {product.trend === "up" && (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +12%
                    </span>
                  )}
                  {product.trend === "down" && (
                    <span className="text-red-600 dark:text-red-400">-8%</span>
                  )}
                  {product.trend === "neutral" && (
                    <span className="text-muted-foreground">0%</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
