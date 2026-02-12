# iOS Native Module Setup

Since you are developing on Windows, you cannot directly build the iOS app. However, these files provide the necessary Native Module implementation for Bluetooth printing on iOS.

## Files
- `RCTBluetoothModule.h`: Header file for the native module.
- `RCTBluetoothModule.m`: Implementation file (Objective-C) using CoreBluetooth.

## How to use (When building for iOS)

### Option 1: Using EAS Build (Managed Workflow with Config Plugin)
If you are using EAS Build, you should ideally create a local Expo Module or a Config Plugin to inject these files. 

### Option 2: Manual Setup (Bare Workflow / Xcode)
If you generate the iOS project (using `npx expo prebuild --platform ios` on a Mac), follow these steps:

1. Copy `RCTBluetoothModule.h` and `RCTBluetoothModule.m` into your iOS project source folder (e.g., `ios/counterapp/`).
2. Open `ios/counterapp.xcworkspace` in Xcode.
3. Add the files to the project target (Right click project -> Add Files...).
4. Ensure `CoreBluetooth.framework` is linked (usually automatic).
5. Build and run.

The React Native autolinking might handle it if packaged properly, but for direct file addition, the above steps are required.

## Permissions
The `app.json` has already been updated with `NSBluetoothAlwaysUsageDescription`.
