/**
 * Home Appliance Timer Card
 *
 * This custom card calculates the timer delay for your appliance based on the desired start time
 * (or effective program end time if the device only supports timing the program end) and the selected
 * program parameters.
 *
 * Config options:
 * - title: The card title.
 * - mode: "start" or "end". When set to "end", a program dropdown is shown with each program's duration.
 * - device_timer_interval: The resolution (in minutes) at which the device timer can be set. Default is 60 (hourly).
 * - ui_time_step: The minute increment for manual time selection. Default is 15.
 * - default_time: (Optional) The default desired start time in HH:MM format (24h).
 * - price_entity: (Optional) An entity that provides the time (in seconds) until the cheapest electricity price.
 *                 If provided, a toggle is available to switch between manual time selection and using the best price.
 * - programs: (Only for mode "end") An array of program configurations. Each program must have:
 *     - name: Name of the program.
 *     - duration: Duration of the program in minutes.
 *     - offset: (Optional) Time offset in minutes (default 0) to adjust the effective program time (e.g. delayed water heating).
 *
 * Features:
 * - Provides a manual time selection interface with up/down arrow buttons for hours and minutes, which is hidden
 *   when "Use Best Price Time" is activated.
 * - In "end" mode, the program dropdown displays the program name along with its duration in (HH:mm) format.
 * - Calculates the effective timer delay as:
 *       (Target start time + program duration - offset) - current time,
 *   then rounds up to the next allowed timer interval.
 * - Seamlessly integrates with Home Assistant's theme by using standard style variables, including a configurable
 *   card border radius.
 *
 * Example:
 * Current time: 08:10.
 * Desired start time: 12:00.
 * Program duration: 2:30 (150 minutes), offset: 10 minutes.
 * Effective program end = 12:00 + 150 - 10 = 14:20.
 * Delay = 14:20 - 08:10 = 6h 10m, rounded (if only whole hours are allowed) up to 7 hours.
 *
**/

class HomeApplianceTimerCard extends HTMLElement {
  constructor() {
    super();
    // Attach shadow DOM for style isolation.
    this.attachShadow({ mode: 'open' });
    // Default configuration values.
    this._config = {
      mode: 'start',               // 'start' to time program start, 'end' to time program end.
      device_timer_interval: 60,   // Device timer can be set only in intervals (in minutes). Default: hourly (60 minutes).
      ui_time_step: 15,            // UI time picker increment (in minutes). Default: 15 minutes.
      programs: [],                // Array of programs (only used in mode 'end').
      price_entity: null,          // Optional entity to derive best price time (in seconds).
      use_best_price: false,       // Internal flag to toggle best price mode.
    };

    // Internal state: selected time for manual target time selection.
    const now = new Date();
    this._selectedHour = now.getHours();
    this._selectedMinute = now.getMinutes();
    // For mode 'end', default program index.
    this._selectedProgram = 0;
  }

  // Called when configuration is set from the YAML.
  setConfig(config) {
    if (!config) {
      throw new Error('No configuration provided');
    }
    // Merge default values with provided configuration.
    this._config = Object.assign({}, this._config, config);

    // If no price entity is provided, force use_best_price to false.
    if (!this._config.price_entity) {
      this._config.use_best_price = false;
    }

    // Validate mode.
    if (this._config.mode !== 'start' && this._config.mode !== 'end') {
      throw new Error('mode must be either "start" or "end"');
    }

    // In mode 'end' a programs array is required.
    if (this._config.mode === 'end' && !Array.isArray(this._config.programs)) {
      throw new Error('For mode "end", programs must be provided as an array');
    }

    // Optionally set a default time (format: "HH:MM").
    if (this._config.default_time) {
      const parts = this._config.default_time.split(':');
      if (parts.length === 2) {
        this._selectedHour = parseInt(parts[0]);
        this._selectedMinute = parseInt(parts[1]);
      }
    }
    this._render();
  }

  // Called by Home Assistant to pass the current state.
  set hass(hass) {
    this._hass = hass;
    // If a price entity is configured, retrieve its value.
    if (this._config.price_entity && hass.states[this._config.price_entity]) {
      const stateObj = hass.states[this._config.price_entity];
      this._bestPriceSeconds = parseInt(stateObj.state);
    } else {
      this._bestPriceSeconds = null;
    }
    this._render();
  }

  // Helper: Create a button with a given label and click handler.
  _createButton(label, onClick) {
    const button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  // Helper: Format time as HH:MM in 24h format with leading zeros.
  _formatTime(hour, minute) {
    return ('0' + hour).slice(-2) + ':' + ('0' + minute).slice(-2);
  }

  // Helper: Compute the target Date based on the selected hour and minute.
  // If the time is earlier than now, the target time is assumed to be on the next day.
  _getTargetTime() {
    const now = new Date();
    let target = new Date(now);
    target.setHours(this._selectedHour, this._selectedMinute, 0, 0);
    if (target <= now) {
      // Assume next day if the selected time is already passed.
      target.setDate(target.getDate() + 1);
    }
    return target;
  }

  // Helper: Compute the timer delay (in minutes) based on the selected options.
  _computeDelay() {
    const now = new Date();
    let targetTime = this._getTargetTime();
    let delayMinutes = 0;

    if (this._config.mode === 'start') {
      // In "start" mode, the delay is the difference between the target start time and now.
      delayMinutes = (targetTime - now) / 60000;
    } else {
      // In "end" mode, the effective end time is calculated by adding the program duration
      // and subtracting the optional offset (e.g. delay before water heating starts).
      const program = this._config.programs[this._selectedProgram];
      const duration = parseInt(program.duration);
      const offset = program.offset ? parseInt(program.offset) : 0;
      const effectiveEndTime = new Date(targetTime.getTime() + (duration - offset) * 60000);
      delayMinutes = (effectiveEndTime - now) / 60000;
    }

    // If delay is less or equal zero, return 0 (will be interpreted as "Start now!").
    if (delayMinutes <= 0) {
      return 0;
    }

    // Round up the delay to the device timer's allowed interval.
    const interval = this._config.device_timer_interval || 60;
    const roundedDelay = Math.ceil(delayMinutes / interval) * interval;
    return roundedDelay;
  }

  // Render the complete card.
  _render() {
    if (!this.shadowRoot) return;
    // Clear existing content.
    this.shadowRoot.innerHTML = '';

    // Create main card container.
    const card = document.createElement('ha-card');

    // Header with title (if provided).
    if (this._config.title) {
      const header = document.createElement('div');
      header.className = 'card-header';
      header.textContent = this._config.title;
      card.appendChild(header);
    }

    // Card content container.
    const content = document.createElement('div');
    content.className = 'card-content';

    // Show best price toggle if a price entity is configured.
    if (this._config.price_entity) {
      const toggleContainer = document.createElement('div');
      toggleContainer.className = 'toggle-container';
      const toggleLabel = document.createElement('label');
      toggleLabel.textContent = 'Use Best Price Time: ';
      const toggleInput = document.createElement('input');
      toggleInput.type = 'checkbox';
      toggleInput.checked = this._config.use_best_price || false;
      toggleInput.addEventListener('change', (e) => {
        this._config.use_best_price = e.target.checked;
        this._render();
      });
      toggleContainer.appendChild(toggleLabel);
      toggleContainer.appendChild(toggleInput);
      content.appendChild(toggleContainer);
    }

    // If not using best price time, display manual time selection UI.
    if (!this._config.use_best_price) {
      // Time selection UI container.
      const timePicker = document.createElement('div');
      timePicker.className = 'time-picker';

      // Hours selection section.
      const hoursContainer = document.createElement('div');
      hoursContainer.className = 'time-section';
      const hourUp = this._createButton('▲', () => {
        this._selectedHour = (this._selectedHour + 1) % 24;
        this._render();
      });
      const hourDisplay = document.createElement('div');
      hourDisplay.className = 'time-display';
      hourDisplay.textContent = ('0' + this._selectedHour).slice(-2);
      const hourDown = this._createButton('▼', () => {
        this._selectedHour = (this._selectedHour + 23) % 24;
        this._render();
      });
      hoursContainer.appendChild(hourUp);
      hoursContainer.appendChild(hourDisplay);
      hoursContainer.appendChild(hourDown);
      timePicker.appendChild(hoursContainer);

      // Minutes selection section.
      const minutesContainer = document.createElement('div');
      minutesContainer.className = 'time-section';
      const minuteUp = this._createButton('▲', () => {
        this._selectedMinute = (this._selectedMinute + this._config.ui_time_step) % 60;
        this._render();
      });
      const minuteDisplay = document.createElement('div');
      minuteDisplay.className = 'time-display';
      minuteDisplay.textContent = ('0' + this._selectedMinute).slice(-2);
      const minuteDown = this._createButton('▼', () => {
        this._selectedMinute = (this._selectedMinute - this._config.ui_time_step + 60) % 60;
        this._render();
      });
      minutesContainer.appendChild(minuteUp);
      minutesContainer.appendChild(minuteDisplay);
      minutesContainer.appendChild(minuteDown);
      timePicker.appendChild(minutesContainer);

      content.appendChild(timePicker);
    } else {
      // If best price mode is active, display the computed best price time.
      const bestPriceDisplay = document.createElement('div');
      bestPriceDisplay.className = 'best-price-display';
      if (this._bestPriceSeconds !== null) {
        const bestTime = new Date(new Date().getTime() + this._bestPriceSeconds * 1000);
        bestPriceDisplay.textContent = 'Best Price Start Time: ' + this._formatTime(bestTime.getHours(), bestTime.getMinutes());
      } else {
        bestPriceDisplay.textContent = 'Best Price Start Time: N/A';
      }
      content.appendChild(bestPriceDisplay);
    }

    // In mode 'end' (program end timing) show a dropdown to select the program.
    if (this._config.mode === 'end' && this._config.programs && this._config.programs.length > 0) {
      const programContainer = document.createElement('div');
      programContainer.className = 'program-container';
      const programLabel = document.createElement('label');
      programLabel.textContent = 'Select Program: ';
      const programSelect = document.createElement('select');
      this._config.programs.forEach((prog, index) => {
        const option = document.createElement('option');
        option.value = index;
        // Format duration in HH:mm.
        const durationMinutes = parseInt(prog.duration);
        const hours = Math.floor(durationMinutes / 60);
        const minutes = durationMinutes % 60;
        const formattedDuration = ('0' + hours).slice(-2) + ':' + ('0' + minutes).slice(-2);
        option.textContent = (prog.name ? prog.name : ('Program ' + (index + 1))) + ' (' + formattedDuration + ')';
        if (index === this._selectedProgram) {
          option.selected = true;
        }
        programSelect.appendChild(option);
      });
      programSelect.addEventListener('change', (e) => {
        this._selectedProgram = parseInt(e.target.value);
        this._render();
      });
      programContainer.appendChild(programLabel);
      programContainer.appendChild(programSelect);
      content.appendChild(programContainer);
    }

    // Compute the timer delay.
    let delayMinutes = 0;
    if (this._config.use_best_price && this._bestPriceSeconds !== null) {
      // Use best price sensor to compute target time.
      const now = new Date();
      const targetTime = new Date(now.getTime() + this._bestPriceSeconds * 1000);
      if (this._config.mode === 'start') {
        delayMinutes = (targetTime - now) / 60000;
      } else {
        const program = this._config.programs[this._selectedProgram];
        const duration = parseInt(program.duration);
        const offset = program.offset ? parseInt(program.offset) : 0;
        const effectiveEndTime = new Date(targetTime.getTime() + (duration - offset) * 60000);
        delayMinutes = (effectiveEndTime - now) / 60000;
      }
      // Round up to the device timer's interval.
      const interval = this._config.device_timer_interval || 60;
      delayMinutes = Math.ceil(delayMinutes / interval) * interval;
    } else {
      delayMinutes = this._computeDelay();
    }

    // Create result display: if delay is <= 0, show "Start now!", else show computed timer setting.
    const resultDisplay = document.createElement('div');
    resultDisplay.className = 'result-display';
    if (delayMinutes <= 0) {
      resultDisplay.textContent = 'Start now!';
    } else {
      // Convert delayMinutes into hours and minutes.
      const hours = Math.floor(delayMinutes / 60);
      const minutes = delayMinutes % 60;
      let resultText = 'Timer Setting: ';
      if (hours > 0) {
        resultText += hours + 'h ';
      }
      if (minutes > 0) {
        resultText += minutes + 'min';
      }
      if (hours === 0 && minutes === 0) {
        resultText = 'Start now!';
      }
      resultDisplay.textContent = resultText;
    }
    content.appendChild(resultDisplay);

    // Append content to the card.
    card.appendChild(content);

    // Add CSS styles so that the card integrates seamlessly into Home Assistant.
    const style = document.createElement('style');
    style.textContent = `
      ha-card {
        font-family: var(--paper-font-body1_-_font-family, sans-serif);
        color: var(--primary-text-color);
        background: var(--card-background-color);
        border-radius: var(--ha-card-border-radius, 12px);
        padding: 16px;
      }
      .card-header {
        font-size: var(--ha-card-header-font-size, 1.5em);
        font-weight: var(--ha-card-header-font-weight, 500);
        padding-bottom: 8px;
        margin-bottom: 16px;
        width: 100%;
      }
      .card-content {
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .toggle-container {
        margin-bottom: 16px;
      }
      .time-picker {
        display: flex;
        flex-direction: row;
        margin-bottom: 16px;
      }
      .time-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin: 0 8px;
      }
      .time-display {
        font-size: 2em;
        margin: 4px 0;
      }
      button {
        background: none;
        border: none;
        color: var(--primary-text-color);
        font-size: 1em;
        cursor: pointer;
      }
      button:focus {
        outline: none;
      }
      .program-container {
        margin-bottom: 16px;
        width: 100%;
        text-align: center;
      }
      .result-display {
        font-size: 1.2em;
        font-weight: bold;
        margin-top: 16px;
      }
      .best-price-display {
        margin-bottom: 16px;
        font-size: 1em;
      }
    `;
    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(card);
  }
}

// Register component
if (!customElements.get("home-appliance-timer-card")) {
  customElements.define("home-appliance-timer-card", HomeApplianceTimerCard);
  console.info(
    `%c andiwirs/ha-home-appliance-timer-card %c v1.0.0 `
  )
}

// Register card
window.customCards = window.customCards || [];
window.customCards.push({
    name: 'Home Appliance Timer Card',
    description: 'A simple card to help timing your home appliances for the cheapest electricity price times',
    type: 'home-appliance-timer-card',
    preview: false,
    documentationURL: `https://github.com/andiwirs/ha-home-appliance-timer-card`,
});
