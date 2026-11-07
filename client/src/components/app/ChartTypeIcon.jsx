import { ChartBarBig, ChartLine, ChartPie, ChartArea, Table2 } from 'lucide-react';

/** Icon for a result's chart type (history rows, answer titles). */
export default function ChartTypeIcon({ chartType, ...props }) {
  switch (chartType) {
    case 'line':
      return <ChartLine {...props} />;
    case 'area':
      return <ChartArea {...props} />;
    case 'pie':
      return <ChartPie {...props} />;
    case 'table':
      return <Table2 {...props} />;
    default:
      return <ChartBarBig {...props} />;
  }
}
