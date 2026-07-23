# brrrr iphone mac apple notifications

# Create a Lumin notifications subsystem that can send push notifications to iOS and macOS devices using the brrr service.
- available from any Lumin App
- add a test button to the brrr settings.html section to send a test notification to the current device

## notification types
- simple text message
- rich json message with title, message, sound, thread_id, expiration_date, volume 
- Warning messages
- Error messages

## Featues
- include sending app name and icon in the notification payload
- include warning level - info, warning, error
- include link to the app in the notification payload


## documentation
https://brrr.now/docs/

## send to all devices
curl -X POST https://api.brrr.now/v1/br_usr_a4c3c956544e7edd90528155941598d5e601194412171df6524bbf957a55f20e \
  -d 'Hello world! 🚀'

## send to iphone 15 pro
curl -X POST https://api.brrr.now/v1/br_dev_4b6de765ab9103a95db879f3d5c426728860f0a2af95cd6ac21b7d2dd4b57646 \
  -d 'Hello iPhone 15 Pro! 🚀'

## send to macbook Air 15
curl -X POST https://api.brrr.now/v1/br_dev_8e7e5c7a3f0c2cc4fee8f14466c383e8c41a0cb70497405159c3dc1aef3e5bfe \
  -d 'Hello MacBook Air 15! 🚀'

## send json test to macbook Air 15
curl -X POST https://api.brrr.now/v1/br_dev_8e7e5c7a3f0c2cc4fee8f14466c383e8c41a0cb70497405159c3dc1aef3e5bfe \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "The coffee machine is currently unreachable. Morale is expected to drop.",
    "title": "Coffee Machine Offline",
    "thread_id": "ops-coffee",
    "sound": "upbeat_bells",
    "expiration_date": "2026-04-23T09:00:00.000Z",
    "volume": 0.8
  }' 

  # iphone 15 pro json test
  curl -X POST https://api.brrr.now/v1/br_dev_4b6de765ab9103a95db879f3d5c426728860f0a2af95cd6ac21b7d2dd4b57646 \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "The coffee machine is currently unreachable. Morale is expected to drop.",
    "title": "Coffee Machine Offline",
    "thread_id": "ops-coffee",
    "sound": "upbeat_bells",
    "expiration_date": "2026-04-23T09:00:00.000Z",
    "volume": 0.8
  }' 