# Torch safety controls

CrowdSync lighting uses a phone torch when supported, with synchronized full-screen light as a fallback. Audience screens stay dark unless the guest chooses screen output or torch control is unavailable. A phone must explicitly join and accept the photosensitivity notice. The torch-control camera track is used only to switch the flashlight. It is not displayed, read, stored, or uploaded; CrowdSync has no audience video recording feature. Screen output needs no camera permission.

Enhanced accessibility protection is enabled for every new room. It caps a pattern at 1.5 device-light on-edges per second, accounting for the number of pulses in that pattern. Turning it off requires the controller to acknowledge this warning:

> We have zero control over what may happen. If you are sensitive to light, stop using/participating and seek a room without flashing rapidly lights.

The pre-show calibration uses one light pulse per second and a generated browser beep; it does not use or record microphone audio. The warning explains that phone torches are binary and cannot be dimmed; screen output uses the controller's selected colors. The local music cue designer can produce at most 24 cues over ten minutes; every cue's effect rate is normalized through the existing protection limits on the server and the audience device. Disabling enhanced protection never disables the fixed safeguard: no more than three rising device-light edges in any rolling second, with a minimum 333 ms gap. The audience browser independently applies the governor and can always turn its output off. Stop, pause, blackout, leave, hidden-page suspension, disconnect, or room end requests light off and stops the torch-control camera track where applicable. Blackout bypasses ordinary command throttling and cancels calibration.

Torch hardware and browser scheduling vary. The app cannot guarantee a particular exposure, hardware shutdown, medical outcome, or accessibility for an individual. The controller and audience page show the risk notice and opt-out controls; organizers should announce the effect and follow venue guidance.

