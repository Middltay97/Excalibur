apply plugin: 'com.android.application'

android {
    namespace = "app.countright.scanner"
    compileSdk = rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "app.countright.scanner"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0.0"
        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
        aaptOptions {
            ignoreAssetsPattern = '!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~'
        }
    }

    // CI/local signing — reads from gradle properties (-P) or env vars.
    // The GitHub Actions workflow decodes the keystore secret to
    // android/app/countright.keystore and passes credentials via -P flags.
    signingConfigs {
        release {
            def ksPath = (project.hasProperty('CR_KEYSTORE_PATH')
                ? CR_KEYSTORE_PATH
                : System.getenv('CR_KEYSTORE_PATH')) ?: 'countright.keystore'
            def ksPass = (project.hasProperty('CR_KEYSTORE_PASSWORD')
                ? CR_KEYSTORE_PASSWORD
                : System.getenv('CR_KEYSTORE_PASSWORD')) ?: ''
            def kAlias = (project.hasProperty('CR_KEY_ALIAS')
                ? CR_KEY_ALIAS
                : System.getenv('CR_KEY_ALIAS')) ?: 'countright'
            def kPass  = (project.hasProperty('CR_KEY_PASSWORD')
                ? CR_KEY_PASSWORD
                : System.getenv('CR_KEY_PASSWORD')) ?: ''
            def ksFile = file(ksPath)
            if (ksFile.exists() && ksPass) {
                storeFile     ksFile
                storePassword ksPass
                keyAlias      kAlias
                keyPassword   kPass
            }
        }
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
            def cfg = signingConfigs.release
            if (cfg.storeFile != null) {
                signingConfig cfg
            }
        }
    }
}

repositories {
    flatDir{
        dirs '../capacitor-cordova-android-plugins/src/main/libs', 'libs'
    }
}

dependencies {
    implementation fileTree(include: ['*.jar'], dir: 'libs')
    implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"
    implementation "androidx.coordinatorlayout:coordinatorlayout:$androidxCoordinatorLayoutVersion"
    implementation "androidx.core:core-splashscreen:$coreSplashScreenVersion"
    implementation project(':capacitor-android')
    testImplementation "junit:junit:$junitVersion"
    androidTestImplementation "androidx.test.ext:junit:$androidxJunitVersion"
    androidTestImplementation "androidx.test.espresso:espresso-core:$androidxEspressoCoreVersion"
    implementation project(':capacitor-cordova-android-plugins')
}

apply from: 'capacitor.build.gradle'

try {
    def servicesJSON = file('google-services.json')
    if (servicesJSON.text) {
        apply plugin: 'com.google.gms.google-services'
    }
} catch(Exception e) {
    logger.info("google-services.json not found, google-services plugin not applied. Push Notifications won't work")
}
