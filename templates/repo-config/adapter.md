# Project Delivery Adapter Configuration

## Delivery Settings
- **adapter_type**: "github" # dot | github | gitlab | custom
- **repository**: "organization/my-service"
- **default_target_branch**: "main"
- **notification_webhook**: "https://hooks.slack.com/services/..." # Optional

## Multi-Branch Settings (If applicable)
- **enable_multi_branch**: false
- **branches**: []
