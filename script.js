// Mood selector logic (basic demo functionality)
let selectedMood = null;
function selectMood(idx) {
  selectedMood = idx;
  document.querySelectorAll('.mood-icons span').forEach((el, i) => {
    el.classList.toggle('selected', i === idx-1);
  });
}
function logMood() {
  let msg = '';
  if(selectedMood) {
    const moods = ["Sad","Neutral","Fine","Happy","Excited"];
    msg = `Mood logged: ${moods[selectedMood-1]}!`;
  } else {
    msg = "Please select a mood!";
  }
  const note = document.getElementById('moodNote').value;
  document.getElementById('moodMessage').textContent = msg + (note ? ' Note: ' + note : '');
}
