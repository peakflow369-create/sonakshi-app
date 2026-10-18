# Native wiring (after `npx cap add android`)

Copy the three .java files into `android/app/src/main/java/com/sonakshi/app/`
(overwrite the generated MainActivity.java).
Put `sonakshi_android.ppn` in `android/app/src/main/assets/`.

## AndroidManifest.xml (inside <manifest>)
```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<queries><intent><action android:name="android.speech.RecognitionService" /></intent></queries>
```
## inside <application>
```xml
<service android:name=".WakeWordService" android:exported="false"
         android:foregroundServiceType="microphone" />
```
## on the existing <activity android:name=".MainActivity" ...>
```xml
android:launchMode="singleTask"
android:showWhenLocked="true"
android:turnScreenOn="true"
```

## android/app/build.gradle
```groovy
android {
  buildFeatures { buildConfig true }
  defaultConfig {
    buildConfigField "String", "PICOVOICE_KEY", "\"${project.findProperty('PICOVOICE_KEY') ?: ''}\""
  }
}
dependencies {
  implementation 'ai.picovoice:porcupine-android:3.0.2'   // use the latest version from Picovoice's Android docs
}
```
## android/gradle.properties (gitignored)
```
PICOVOICE_KEY=your-access-key
```
