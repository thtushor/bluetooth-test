# Android Build Cache Cleanup Guide

Follow these steps to resolve build errors or clear old data for both Debug and Release builds.

## 1. Clean Gradle Build
The fastest way to clear build artifacts.
```bash
cd android
./gradlew clean
```

## 2. Hard Reset (Manual Deletion)
Use this if the project is still using old code or assets in the release APK.
- Delete the `android/app/build` folder.
- Delete the `android/.gradle` folder.
- Delete the `android/build` folder.

## 3. Clear Metro Bundler Cache
If the JavaScript changes are not reflecting in the build.
```bash
npm start -- --reset-cache
```

## 4. Release Build Command (with Clean)
Always clean before generating a final release APK to ensure no old cache is included.
```bash
cd android
./gradlew clean assembleRelease
```

## 5. Pro-tip: Single Command Reset
You can use this one-liner to clear everything:
```bash
rm -rf android/app/build && cd android && ./gradlew clean && cd .. && npm start -- --reset-cache
```
