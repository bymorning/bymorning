;(function () {
  function read(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  var savedTheme = read("bymorning-theme-id")
  var theme = savedTheme === "bymorning" || savedTheme === "ink" ? savedTheme : "paper"
  var savedScheme = read("bymorning-color-scheme")
  var scheme = savedScheme === "light" || savedScheme === "dark" || savedScheme === "system" ? savedScheme : "dark"
  var systemDark = false
  if (scheme === "system") {
    try {
      systemDark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
    } catch {}
  }
  var mode = scheme === "dark" || systemDark ? "dark" : "light"
  var color = "var(--color-bg-deep)"

  try {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.colorScheme = mode
    document.documentElement.style.backgroundColor = color
    var meta = document.querySelector("meta[name='theme-color']")
    if (meta && typeof getComputedStyle === "function") {
      var updateThemeColor = function () {
        meta.setAttribute("content", getComputedStyle(document.documentElement).backgroundColor)
      }
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(updateThemeColor)
      else updateThemeColor()
    }
  } catch {}
})()
