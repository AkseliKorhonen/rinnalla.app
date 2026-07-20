const { withMainActivity } = require("@expo/config-plugins");

const CALL_LAUNCH_TOKEN_EXTRA = "app.rinnalla.extra.CALL_LAUNCH_TOKEN";
const CALL_LAUNCH_PREFERENCES = "rinnalla-call-screen";
const CALL_LAUNCH_TOKEN_KEY = "authorized-launch-token";
const HELPER_MARKER = "// @rinnalla/call-lock-screen-helper";
const ON_CREATE_MARKER = "// @rinnalla/call-lock-screen-on-create";
const ON_NEW_INTENT_MARKER = "// @rinnalla/call-lock-screen-on-new-intent";

function findClosingBrace(source, openingBraceIndex) {
  let depth = 0;

  for (let index = openingBraceIndex; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  throw new Error("Could not find the end of an Android activity method.");
}

function findMethod(source, signature) {
  const match = signature.exec(source);
  if (!match) {
    return null;
  }

  const openingBraceIndex = source.indexOf("{", match.index);
  return {
    match,
    openingBraceIndex,
    closingBraceIndex: findClosingBrace(source, openingBraceIndex),
  };
}

function addImport(source, importName) {
  const importStatement = `import ${importName}`;
  if (source.includes(importStatement)) {
    return source;
  }

  const imports = [...source.matchAll(/^import .+$/gm)];
  if (imports.length === 0) {
    throw new Error("Could not find the imports in MainActivity.kt.");
  }

  const lastImport = imports[imports.length - 1];
  const insertionIndex = lastImport.index + lastImport[0].length;
  return `${source.slice(0, insertionIndex)}\n${importStatement}${source.slice(insertionIndex)}`;
}

function addLockScreenHelper(source) {
  if (source.includes(HELPER_MARKER)) {
    return source;
  }

  const classMatch = /class\s+MainActivity\s*:\s*ReactActivity\(\)\s*\{/.exec(source);
  if (!classMatch) {
    throw new Error("Could not find MainActivity in MainActivity.kt.");
  }

  const classOpeningEnd = classMatch.index + classMatch[0].length;
  const privateExtra = `${HELPER_MARKER}
private const val RINNALLA_CALL_LAUNCH_TOKEN_EXTRA =
  "${CALL_LAUNCH_TOKEN_EXTRA}"
private const val RINNALLA_CALL_LAUNCH_PREFERENCES = "${CALL_LAUNCH_PREFERENCES}"
private const val RINNALLA_CALL_LAUNCH_TOKEN_KEY = "${CALL_LAUNCH_TOKEN_KEY}"

`;
  const helper = `
  private fun updateCallLockScreenVisibility(
    callIntent: Intent?,
    hideWhenUnauthorized: Boolean,
  ) {
    val launchToken = callIntent?.getStringExtra(RINNALLA_CALL_LAUNCH_TOKEN_EXTRA)
    callIntent?.removeExtra(RINNALLA_CALL_LAUNCH_TOKEN_EXTRA)
    val preferences = getSharedPreferences(
      RINNALLA_CALL_LAUNCH_PREFERENCES,
      Context.MODE_PRIVATE,
    )
    val authorizedTokens = preferences.getStringSet(
      RINNALLA_CALL_LAUNCH_TOKEN_KEY,
      emptySet(),
    ) ?: emptySet()
    val shouldShowCallWhenLocked =
      launchToken != null && authorizedTokens.contains(launchToken)

    if (shouldShowCallWhenLocked) {
      val remainingTokens = authorizedTokens.toMutableSet().apply { remove(launchToken) }
      val editor = preferences.edit()
      if (remainingTokens.isEmpty()) {
        editor.remove(RINNALLA_CALL_LAUNCH_TOKEN_KEY)
      } else {
        editor.putStringSet(RINNALLA_CALL_LAUNCH_TOKEN_KEY, remainingTokens)
      }
      editor.commit()
    } else if (!hideWhenUnauthorized) {
      return
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(shouldShowCallWhenLocked)
      setTurnScreenOn(shouldShowCallWhenLocked)
    } else {
      val lockScreenFlags =
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON

      if (shouldShowCallWhenLocked) {
        window.addFlags(lockScreenFlags)
      } else {
        window.clearFlags(lockScreenFlags)
      }
    }
  }
`;

  return `${source.slice(0, classMatch.index)}${privateExtra}${source.slice(
    classMatch.index,
    classOpeningEnd,
  )}${helper}${source.slice(classOpeningEnd)}`;
}

function addOnCreateHandoff(source) {
  if (source.includes(ON_CREATE_MARKER)) {
    return source;
  }

  const onCreate = findMethod(
    source,
    /override\s+fun\s+onCreate\s*\(\s*savedInstanceState\s*:\s*Bundle\?\s*\)\s*\{/,
  );
  if (!onCreate) {
    throw new Error("Could not find MainActivity.onCreate in MainActivity.kt.");
  }

  const methodBody = source.slice(onCreate.openingBraceIndex, onCreate.closingBraceIndex);
  const superCall = /super\.onCreate\([^\r\n;]*\);?/.exec(methodBody);
  if (!superCall) {
    throw new Error("Could not find super.onCreate in MainActivity.kt.");
  }

  // Apply the lock-screen state before ReactActivity creates and attaches its views.
  const insertionIndex = onCreate.openingBraceIndex + superCall.index;
  const handoff = `${ON_CREATE_MARKER}
    updateCallLockScreenVisibility(intent, true)
    `;

  return `${source.slice(0, insertionIndex)}${handoff}${source.slice(insertionIndex)}`;
}

function addOnNewIntentHandoff(source) {
  if (source.includes(ON_NEW_INTENT_MARKER)) {
    return source;
  }

  const onNewIntent = findMethod(
    source,
    /override\s+fun\s+onNewIntent\s*\(\s*(\w+)\s*:\s*Intent\??\s*\)\s*\{/,
  );

  if (onNewIntent) {
    const intentParameter = onNewIntent.match[1];
    const methodBody = source.slice(
      onNewIntent.openingBraceIndex,
      onNewIntent.closingBraceIndex,
    );
    const superCall = new RegExp(
      `super\\.onNewIntent\\(\\s*${intentParameter}\\s*\\);?`,
    ).exec(methodBody);
    const insertionIndex = superCall
      ? onNewIntent.openingBraceIndex + superCall.index + superCall[0].length
      : onNewIntent.openingBraceIndex + 1;
    const setIntent = /\bsetIntent\s*\(/.test(methodBody)
      ? ""
      : `\n    setIntent(${intentParameter})`;
    const handoff = `${setIntent}
    ${ON_NEW_INTENT_MARKER}
    updateCallLockScreenVisibility(${intentParameter}, false)`;

    return `${source.slice(0, insertionIndex)}${handoff}${source.slice(insertionIndex)}`;
  }

  const onCreate = findMethod(
    source,
    /override\s+fun\s+onCreate\s*\(\s*savedInstanceState\s*:\s*Bundle\?\s*\)\s*\{/,
  );
  if (!onCreate) {
    throw new Error("Could not find where to add MainActivity.onNewIntent.");
  }

  const method = `

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    ${ON_NEW_INTENT_MARKER}
    updateCallLockScreenVisibility(intent, false)
  }`;

  return `${source.slice(0, onCreate.closingBraceIndex + 1)}${method}${source.slice(
    onCreate.closingBraceIndex + 1,
  )}`;
}

function withCallLockScreen(config) {
  return withMainActivity(config, (activityConfig) => {
    if (activityConfig.modResults.language !== "kt") {
      throw new Error("The call lock-screen plugin requires a Kotlin MainActivity.");
    }

    let source = activityConfig.modResults.contents;
    source = addImport(source, "android.content.Intent");
    source = addImport(source, "android.content.Context");
    source = addImport(source, "android.view.WindowManager");
    source = addLockScreenHelper(source);
    source = addOnCreateHandoff(source);
    source = addOnNewIntentHandoff(source);
    activityConfig.modResults.contents = source;

    return activityConfig;
  });
}

module.exports = withCallLockScreen;
module.exports.CALL_LAUNCH_TOKEN_EXTRA = CALL_LAUNCH_TOKEN_EXTRA;
