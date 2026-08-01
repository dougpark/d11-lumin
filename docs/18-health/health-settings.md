# health settings

## settings.html
- should health details be stored in their own table or in the settings table? (probably their own table)
- secured by user_id, so each user can only see their own health details
- want to be able to edit health details in the settings page, but also want to be able to view them in the health page
- follow the same UI/UX guidelines as the settings page for consistency
- is it better to have each health item in its own row, or have a single form with all items? (probably a single json with all items)

### New items to add in Health section
- Full Name
- Birthday mm/dd/yyyy
- Gender - dropdown menu with options (Male, Female)
- Emergency Contact - medium form block of text
- Medications - large form block of text
- Height in inches
- Target Weight
- Target BMI
- Health History - large form block of text
- Vaccinations - large form block of text
- Allergies - large form block of text
- Blood Type - dropdown menu with options (A+, A-, B+, B-, AB+, AB-, O+, O-)
- Primary Care Physician - medium form block of text
- Notes - large form block of text
