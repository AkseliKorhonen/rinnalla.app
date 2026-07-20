# Senior mode

Senior mode turns the native rinnalla.app client into a dedicated family calling
screen. It is configured separately on each device, so enabling it on a tablet
does not restrict the same account on a phone or browser.

## Configure the device

1. Open household settings from the cog button.
2. Under **Senior mode**, select one or more family members.
3. Select **Start Senior mode**.
4. Test each picture before handing over the device.

The regular app controls, household management, and sign-out action are hidden.
The Android back button is also ignored. To return to the regular app, press and
hold the invisible target in the upper-right corner for five seconds and confirm
the exit dialog.

If every selected person leaves the household, or the configured household is
removed, the app safely leaves Senior mode instead of trapping the user on an
empty screen.

## Pin the app at operating-system level

The in-app guard is intended to prevent accidental exits; it is not a security
boundary. An ordinary app cannot silently lock the operating system or prevent
the Home and power buttons.

On Android, enable **App pinning** (sometimes called **Screen pinning**) in the
device security settings, open rinnalla.app, open the recent-apps screen, and pin
the app. The exact menu names vary by device manufacturer. Configure the device
to require its PIN before unpinning when that option is available.

On iPhone or iPad, enable **Guided Access** under Accessibility, open
rinnalla.app, and start Guided Access with the configured accessibility shortcut.
Use a Guided Access passcode that the Senior mode user does not need to know.

For managed or unattended devices that must never leave the app, use Android
lock-task mode through a device-management system. That requires device-owner
provisioning and is intentionally outside the normal development build.
