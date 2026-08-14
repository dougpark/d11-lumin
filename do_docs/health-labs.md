# health labs page and db
- similar to the health page, but focused on lab results and metrics
- call it health-labs 
- the UI/UX is important to simplify data entry and allow for side-by-side comparison of the last N lab results
- Important UI flow to add a new lab_metric when adding a new lab_result (if the metric doesn't exist yet)
- standard report to show all lab_results for a given lab_panel (date) in a table format
- history report to show side by side comparison of the last N lab_results for all labs in a panel. if history does not exist for a given metric, leave the cell blank. show the ref_range and unit for each metric in the first column. show delta indicators (green/red) if the value changed significantly compared to the prior test column. bold or color-code individual cell values when they fall outside the snapshot ref_range.
- mobile and desktop friendly, responsive design


To support both flexible data entry and side-by-side comparative reports (like comparing the last 6 test dates), the best approach is to separate how you store the data from how you view the data.
Storing records in a normalized format (one row per result) allows you to dynamic pivot the data into a matrix/comparative layout at query time.

1. Database Schema Design (Normalized Storage)
Instead of storing data pre-pivoted into columns, store individual readings as discrete rows linked to a parent lab record.
Key Entities
• lab_panels: Represents the lab event (e.g., "Annual Physical Labs" on 2026-08-01).
• lab_metrics: Defines the test parameter (e.g., Glucose, HDL Cholesterol, TSH) along with default units.
• lab_results: Stores the actual value recorded for a specific metric on a specific panel.
-- Represents the lab session/event
CREATE TABLE lab_panels (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,         -- e.g., '2026-08-01'
    source TEXT                 -- e.g., 'Quest Diagnostics', 'Labcorp'
);

-- Catalog of unique tests/metrics
CREATE TABLE lab_metrics (
    id TEXT PRIMARY KEY,        -- e.g., 'hdl_cholesterol'
    name TEXT NOT NULL,         -- e.g., 'HDL Cholesterol'
    unit TEXT,                  -- e.g., 'mg/dL'
    category TEXT               -- e.g., 'Lipid Panel'
);

-- Individual measurements
CREATE TABLE lab_results (
    id TEXT PRIMARY KEY,
    panel_id TEXT NOT NULL REFERENCES lab_panels(id),
    metric_id TEXT NOT NULL REFERENCES lab_metrics(id),
    value REAL,                 -- Numeric value for graphing/comparison
    text_value TEXT,            -- Fallback for qualitative results (e.g., 'Negative')
    ref_range TEXT              -- Historical snapshot of reference range (e.g., '40-60')
);

2. Transforming Rows into a Side-by-Side Matrix
To display the last N labs side-by-side, you transform (pivot) narrow records into a matrix where:
• Rows = Test Metrics (e.g., Glucose, LDL, HDL)
• Columns = Lab Dates ordered chronologically (most recent first or last)
Target Layout Structure
Metric	Ref Range	Unit	Aug 14, 2026	Feb 10, 2026	Aug 05, 2025	Mar 12, 2025
Total Cholesterol	< 200	mg/dL	185	192	205	198
HDL	> 40	mg/dL	58	55	52	50
LDL	< 100	mg/dL	110	118	130	124
Triglycerides	< 150	mg/dL	85	95	115	120
3. Implementation Approaches
Depending on your preference, you can generate this comparison matrix in SQL or in application code.
Option A: In-Memory / JavaScript Transformation (Recommended)
Query the last 6 panel dates for a given panel type/category, fetch all associated lab_results, and group them in application memory:
type MetricComparisonRow = {
  metricId: string;
  metricName: string;
  unit: string;
  refRange: string;
  // Map panel date to result value
  valuesByDate: Record<string, number | string | null>; 
};

function buildComparisonMatrix(panels: Panel[], results: Result[]): MetricComparisonRow[] {
  // 1. Extract and sort unique panel dates (up to last N)
  const dates = panels.map(p => p.date).sort().reverse().slice(0, 6);

  // 2. Aggregate metrics across panels into single rows
  const matrix: Record<string, MetricComparisonRow> = {};

  for (const r of results) {
    if (!matrix[r.metricId]) {
      matrix[r.metricId] = {
        metricId: r.metricId,
        metricName: r.metricName,
        unit: r.unit,
        refRange: r.ref_range,
        valuesByDate: {}
      };
    }
    matrix[r.metricId].valuesByDate[r.panelDate] = r.value ?? r.text_value;
  }

  return Object.values(matrix);
}

Option B: Conditional Aggregation in SQL
If you prefer pure database queries, you can dynamically construct conditional CASE statements based on the top 6 panel IDs:
SELECT 
    m.name AS metric_name,
    r.ref_range,
    m.unit,
    MAX(CASE WHEN p.date = '2026-08-01' THEN r.value END) AS "2026-08-01",
    MAX(CASE WHEN p.date = '2026-02-10' THEN r.value END) AS "2026-02-10",
    MAX(CASE WHEN p.date = '2025-08-05' THEN r.value END) AS "2025-08-05"
FROM lab_results r
JOIN lab_panels p ON r.panel_id = p.id
JOIN lab_metrics m ON r.metric_id = m.id
WHERE m.category = 'Lipid Panel'
GROUP BY m.id, m.name, r.ref_range, m.unit;

Key UI Considerations
• Delta Indicators: Highlight values in green/red if they changed significantly compared to the prior test column.
• Out-of-Range Flags: Bold or color-code individual cell values when they fall outside the snapshot ref_range.
• Missing Values: Empty cells handle tests that weren't ordered during every single lab visit.
Would you prefer to do the matrix pivot transformation on the server/API layer, or in SQL directly?