# One click, one soundtrack: plays the demo film fullscreen and the licensed
# track from the measured cue (5:44.0) at the same instant. Nothing is ever
# muxed together — the song never enters a file.
#
# Keys: q or Esc quits either player.

$video = Join-Path $PSScriptRoot "secrab_ring_intro.mp4"
$mp3 = "G:\Github\Demo-01\Daft Punk - Giorgio by Moroder (Official Audio).mp3"

if (-not (Test-Path $mp3)) {
    Write-Host "MP3 not found: $mp3 — playing film with SFX only."
    Start-Process ffplay -ArgumentList @("-hide_banner", "-fs", "-autoexit", "`"$video`"")
    exit
}

# Audio first (tiny head start offsets its longer seek), then the film.
Start-Process ffplay -ArgumentList @(
    "-hide_banner", "-nodisp", "-autoexit", "-ss", "5:44.0", "`"$mp3`""
)
Start-Sleep -Milliseconds 120
Start-Process ffplay -ArgumentList @(
    "-hide_banner", "-fs", "-autoexit", "`"$video`""
)
