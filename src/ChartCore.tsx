import ReactEChartsCore from "echarts-for-react/lib/core";
import { BarChart, HeatmapChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  HeatmapChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

function ChartCore({ option, height }: { option: unknown; height: number }) {
  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      style={{ height }}
      opts={{ renderer: "canvas" }}
      notMerge
    />
  );
}

export default ChartCore;
