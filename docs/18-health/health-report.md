# health report

## health.html

### Analysis Section
- create a new button to create a health report
- include the date range similar to the csv export button, so the user can select a date range for the health report
- report should be generated in a new tab, so the user can easily print or save the report as a PDF

### Report Layout
- Lumin Logo and Health Report title at the top of the report
- include the date range in the report header, so the user can see the date range for the health report
- include a left column for personal information, a right column for health metrics, and a full width section for charts and health data rows
- include a table for health data rows
- Report Title: Health Report
- Generated Date: mm/dd/yyyy
- Date Range: mm/dd/yyyy - mm/dd/yyyy

#### left column
-- Full Name
-- Birthday
-- Gender
-- Emergency Contact

#### Right Column
- Height
- Target Weight
- Target BMI

#### Full Width Section
- Included rows are based on the date range selected by the user, so the user can see their health data for the selected date range
- Charts (see existing charts in health.html)
- full width section for charts, including weight, Glucose, Heart Rate, Blood Pressure

- Health data rows (see existing health data table in health.html)
-- Date, weight, Glucose, blood pressure, heart rate, calculated BMI
-- notes on second row, so each health data row is 2 rows in the report