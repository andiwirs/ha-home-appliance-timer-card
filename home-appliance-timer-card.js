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
 * - Provides a manual time selection interface with up/down arrow buttons for hours and minutes.
 *   Manual selection remains visible even when "Use Best Price Time" is activated, allowing users to override it.
 *   If overridden, the toggle automatically turns off. Re-enabling it resets to the best price time.
 *   If manually adjusted back to the best price time, the toggle automatically turns on again.
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
    this.attachShadow({ mode: 'open' });
    this._config = {
      mode: 'start',
      device_timer_interval: 60,
      ui_time_step: 15,
      programs: [],
      price_entity: null,
      use_best_price: false,
    };

    const now = new Date();
    this._selectedHour = now.getHours();
    this._selectedMinute = now.getMinutes();
    this._selectedProgram = 0;
    this._language = null;
    this._dropdownOpen = false;
    
    // Speichern der letzten manuellen Zeiteinstellung
    this._lastManualHour = null;
    this._lastManualMinute = null;
  }

  setConfig(config) {
    if (!config) {
      throw new Error('No configuration provided');
    }
    this._config = Object.assign({}, this._config, config);

    if (!this._config.price_entity) {
      this._config.use_best_price = false;
    }

    if (this._config.mode !== 'start' && this._config.mode !== 'end') {
      throw new Error('mode must be either "start" or "end"');
    }

    if (this._config.mode === 'end' && !Array.isArray(this._config.programs)) {
      throw new Error('For mode "end", programs must be provided as an array');
    }

    if (this._config.default_time) {
      const parts = this._config.default_time.split(':');
      if (parts.length === 2) {
        this._selectedHour = parseInt(parts[0]);
        this._selectedMinute = parseInt(parts[1]);
      }
    }
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    
    // Detect language from Home Assistant
    if (hass.language) {
      this._language = hass.language;
    }
    
    if (this._config.price_entity && hass.states[this._config.price_entity]) {
      const stateObj = hass.states[this._config.price_entity];
      this._bestPriceSeconds = parseInt(stateObj.state);
      
      // Wenn der Schalter aktiviert ist, setze die Startzeit auf die günstigste Zeit
      if (this._bestPriceSeconds !== null) {
        const bestTime = new Date(new Date().getTime() + this._bestPriceSeconds * 1000);
        this._bestPriceHour = bestTime.getHours();
        this._bestPriceMinute = bestTime.getMinutes();
        
        // Wenn der Schalter aktiviert ist, setze die Startzeit auf die günstigste Zeit
        if (this._config.use_best_price) {
          this._selectedHour = this._bestPriceHour;
          this._selectedMinute = this._bestPriceMinute;
        }
      }
    } else {
      this._bestPriceSeconds = null;
      this._bestPriceHour = null;
      this._bestPriceMinute = null;
    }
    
    // Nur rendern, wenn das Dropdown nicht geöffnet ist
    if (!this._dropdownOpen) {
      this._render();
    }
  }

  _createButton(label, onClick) {
    const button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  _formatTime(hour, minute) {
    return ('0' + hour).slice(-2) + ':' + ('0' + minute).slice(-2);
  }

  _getTargetTime() {
    const now = new Date();
    let target = new Date(now);
    target.setHours(this._selectedHour, this._selectedMinute, 0, 0);
    if (target <= now) {
      target.setDate(target.getDate() + 1);
    }
    return target;
  }

  _computeDelay() {
    const now = new Date();
    let targetTime = this._getTargetTime();
    let delayMinutes = 0;

    if (this._config.mode === 'start') {
      delayMinutes = (targetTime - now) / 60000;
    } else {
      const program = this._config.programs[this._selectedProgram];
      const duration = parseInt(program.duration);
      const offset = program.offset ? parseInt(program.offset) : 0;
      const effectiveEndTime = new Date(targetTime.getTime() + (duration - offset) * 60000);
      delayMinutes = (effectiveEndTime - now) / 60000;
    }

    if (delayMinutes <= 0) {
      return 0;
    }

    const interval = this._config.device_timer_interval || 60;
    const roundedDelay = Math.ceil(delayMinutes / interval) * interval;
    return roundedDelay;
  }

  // Prüft, ob die aktuell gewählte Zeit der günstigsten Zeit entspricht
  _isSelectedTimeBestPrice() {
    if (this._bestPriceHour === null || this._bestPriceMinute === null) return false;
    return this._selectedHour === this._bestPriceHour && this._selectedMinute === this._bestPriceMinute;
  }

  // Localization helper
  _t(textKey) {
    const translations = {
      'use_best_price': {
        'de': 'Günstigste Startzeit',
        'en': 'Cheapest start time'
      },
      'select_program': {
        'de': 'Programm',
        'en': 'Program'
      },
      'best_price_start': {
        'de': 'Günstigste Startzeit',
        'en': 'Best Price Start Time'
      },
      'start_time': {
        'de': 'Startzeit',
        'en': 'Start Time'
      },
      'timer_setting': {
        'de': 'Timer',
        'en': 'Timer'
      },
      'start_now': {
        'de': 'Jetzt starten!',
        'en': 'Start now!'
      },
      'hour': {
        'de': 'h',
        'en': 'h'
      },
      'minute': {
        'de': 'min',
        'en': 'min'
      },
      'not_available': {
        'de': 'Nicht verfügbar',
        'en': 'N/A'
      }
    };
    
    const lang = (this._language && this._language.substring(0, 2) === 'de') ? 'de' : 'en';
    return translations[textKey][lang] || translations[textKey]['en'];
  }

  _render() {
    if (!this.shadowRoot) return;
    this.shadowRoot.innerHTML = '';

    const card = document.createElement('ha-card');

    if (this._config.title) {
      const header = document.createElement('div');
      header.className = 'card-header';
      header.textContent = this._config.title;
      card.appendChild(header);
    }

    const content = document.createElement('div');
    content.className = 'card-content';

    // Programm-Auswahl zuerst anzeigen
    if (this._config.mode === 'end' && this._config.programs && this._config.programs.length > 0) {
      const programRow = document.createElement('div');
      programRow.className = 'row program-row';
      
      const programLabel = document.createElement('div');
      programLabel.className = 'name program-label';
      programLabel.textContent = this._t('select_program');
      
      const programContainer = document.createElement('div');
      programContainer.className = 'state';
      
      const programSelect = document.createElement('select');
      programSelect.className = 'dropdown';
      
      // Event-Listener für das Öffnen und Schließen des Dropdowns
      programSelect.addEventListener('mousedown', () => {
        this._dropdownOpen = true;
      });
      
      programSelect.addEventListener('blur', () => {
        setTimeout(() => {
          this._dropdownOpen = false;
        }, 200);
      });
      
      this._config.programs.forEach((prog, index) => {
        const option = document.createElement('option');
        option.value = index;
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
        setTimeout(() => {
          this._render();
        }, 100);
      });
      
      programContainer.appendChild(programSelect);
      programRow.appendChild(programLabel);
      programRow.appendChild(programContainer);
      
      content.appendChild(programRow);
    }

    // Günstigste Startzeit Schalter
    if (this._config.price_entity) {
      const toggleRow = document.createElement('div');
      toggleRow.className = 'row';
      
      const iconContainer = document.createElement('div');
      iconContainer.className = 'icon-container';
      const icon = document.createElement('ha-icon');
      icon.setAttribute('icon', 'mdi:progress-clock');
      iconContainer.appendChild(icon);
      
      const toggleLabel = document.createElement('div');
      toggleLabel.className = 'name';
      toggleLabel.textContent = this._t('use_best_price');
      
      const toggleContainer = document.createElement('div');
      toggleContainer.className = 'state';
      
      // HA-Style Switch
      const switchContainer = document.createElement('div');
      switchContainer.className = 'ha-switch-container';
      
      const toggleSwitch = document.createElement('ha-switch');
      
      // Schalter basierend auf aktuellem Zustand setzen
      toggleSwitch.checked = this._isSelectedTimeBestPrice();
      this._config.use_best_price = toggleSwitch.checked;
      
      toggleSwitch.addEventListener('change', (e) => {
        const wasChecked = this._config.use_best_price;
        this._config.use_best_price = e.target.checked;
        
        if (this._config.use_best_price) {
          // Speichere aktuelle Zeit, bevor wir zur günstigsten Zeit wechseln
          if (!wasChecked) {
            this._lastManualHour = this._selectedHour;
            this._lastManualMinute = this._selectedMinute;
          }
          
          // Wenn eingeschaltet, setze auf günstigste Zeit
          if (this._bestPriceHour !== null && this._bestPriceMinute !== null) {
            this._selectedHour = this._bestPriceHour;
            this._selectedMinute = this._bestPriceMinute;
          }
        } else {
          // Wenn ausgeschaltet, setze auf letzte manuelle Zeit zurück
          if (this._lastManualHour !== null && this._lastManualMinute !== null) {
            this._selectedHour = this._lastManualHour;
            this._selectedMinute = this._lastManualMinute;
          }
        }
        
        this._render();
      });
      
      switchContainer.appendChild(toggleSwitch);
      toggleContainer.appendChild(switchContainer);
      
      toggleRow.appendChild(iconContainer);
      toggleRow.appendChild(toggleLabel);
      toggleRow.appendChild(toggleContainer);
      
      content.appendChild(toggleRow);
    }

    // Time selection row with clock icon
    const timeRow = document.createElement('div');
    timeRow.className = 'row';
    
    const timeIconContainer = document.createElement('div');
    timeIconContainer.className = 'icon-container';
    const timeIcon = document.createElement('ha-icon');
    timeIcon.setAttribute('icon', 'mdi:clock-start');
    timeIconContainer.appendChild(timeIcon);
    
    const timeLabel = document.createElement('div');
    timeLabel.className = 'name';
    timeLabel.textContent = this._t('start_time');
    
    const timeContainer = document.createElement('div');
    timeContainer.className = 'state';
    
    // Immer Zeitauswahl anzeigen
    const timePicker = document.createElement('div');
    timePicker.className = 'time-picker';

    const hoursContainer = document.createElement('div');
    hoursContainer.className = 'time-section';
    const hourUp = this._createButton('▲', () => {
      this._selectedHour = (this._selectedHour + 1) % 24;
      
      // Speichere die manuelle Zeiteinstellung
      this._lastManualHour = this._selectedHour;
      this._lastManualMinute = this._selectedMinute;
      
      // Prüfen, ob die neue Zeit der günstigsten Zeit entspricht
      this._config.use_best_price = this._isSelectedTimeBestPrice();
      
      this._render();
    });
    const hourDisplay = document.createElement('div');
    hourDisplay.className = 'time-display';
    hourDisplay.textContent = ('0' + this._selectedHour).slice(-2);
    const hourDown = this._createButton('▼', () => {
      this._selectedHour = (this._selectedHour + 23) % 24;
      
      // Speichere die manuelle Zeiteinstellung
      this._lastManualHour = this._selectedHour;
      this._lastManualMinute = this._selectedMinute;
      
      // Prüfen, ob die neue Zeit der günstigsten Zeit entspricht
      this._config.use_best_price = this._isSelectedTimeBestPrice();
      
      this._render();
    });
    hoursContainer.appendChild(hourUp);
    hoursContainer.appendChild(hourDisplay);
    hoursContainer.appendChild(hourDown);
    timePicker.appendChild(hoursContainer);

    const minutesContainer = document.createElement('div');
    minutesContainer.className = 'time-section';
    const minuteUp = this._createButton('▲', () => {
      this._selectedMinute = (this._selectedMinute + this._config.ui_time_step) % 60;
      
      // Speichere die manuelle Zeiteinstellung
      this._lastManualHour = this._selectedHour;
      this._lastManualMinute = this._selectedMinute;
      
      // Prüfen, ob die neue Zeit der günstigsten Zeit entspricht
      this._config.use_best_price = this._isSelectedTimeBestPrice();
      
      this._render();
    });
    const minuteDisplay = document.createElement('div');
    minuteDisplay.className = 'time-display';
    minuteDisplay.textContent = ('0' + this._selectedMinute).slice(-2);
    const minuteDown = this._createButton('▼', () => {
      this._selectedMinute = (this._selectedMinute - this._config.ui_time_step + 60) % 60;
      
      // Speichere die manuelle Zeiteinstellung
      this._lastManualHour = this._selectedHour;
      this._lastManualMinute = this._selectedMinute;
      
      // Prüfen, ob die neue Zeit der günstigsten Zeit entspricht
      this._config.use_best_price = this._isSelectedTimeBestPrice();
      
      this._render();
    });
    minutesContainer.appendChild(minuteUp);
    minutesContainer.appendChild(minuteDisplay);
    minutesContainer.appendChild(minuteDown);
    timePicker.appendChild(minutesContainer);
    
    timeContainer.appendChild(timePicker);
    
    timeRow.appendChild(timeIconContainer);
    timeRow.appendChild(timeLabel);
    timeRow.appendChild(timeContainer);
    
    content.appendChild(timeRow);

    let delayMinutes = this._computeDelay();

    const resultRow = document.createElement('div');
    resultRow.className = 'row result-row';
    
    const resultLabel = document.createElement('div');
    resultLabel.className = 'name';
    resultLabel.textContent = this._t('timer_setting');
    
    const resultDisplay = document.createElement('div');
    resultDisplay.className = 'state result-display';
    
    if (delayMinutes <= 0) {
      resultDisplay.textContent = this._t('start_now');
    } else {
      const hours = Math.floor(delayMinutes / 60);
      const minutes = delayMinutes % 60;
      let resultText = '';
      if (hours > 0) {
        resultText += hours + this._t('hour') + ' ';
      }
      if (minutes > 0) {
        resultText += minutes + this._t('minute');
      }
      if (hours === 0 && minutes === 0) {
        resultText = this._t('start_now');
      }
      resultDisplay.textContent = resultText;
    }
    
    resultRow.appendChild(resultLabel);
    resultRow.appendChild(resultDisplay);
    
    content.appendChild(resultRow);

    card.appendChild(content);

    const style = document.createElement('style');
    style.textContent = `
      :host {
        --row-height: 40px;
        --secondary-text-color: var(--primary-text-color);
      }
      ha-card {
        padding: 16px;
        color: var(--primary-text-color);
      }
      .card-header {
        color: var(--ha-card-header-color, --primary-text-color);
        font-family: var(--ha-card-header-font-family, inherit);
        font-size: var(--ha-card-header-font-size, 24px);
        letter-spacing: -0.012em;
        line-height: 32px;
        display: block;
        padding: 8px 0 16px;
      }
      .card-content {
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      .row {
        display: flex;
        align-items: center;
        min-height: var(--row-height);
        margin-bottom: 8px;
      }
      .program-row {
        display: flex;
        align-items: center;
        min-height: var(--row-height);
        margin-bottom: 8px;
      }
      .icon-container {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        color: var(--paper-item-icon-color, var(--primary-text-color));
      }
      .name {
        flex: 1;
        margin-left: 8px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 120px;
      }
      .program-label {
        min-width: 160px;
        flex-shrink: 0;
        white-space: nowrap;
        overflow: visible;
      }
      .state {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        min-width: 120px;
      }
      /* HA-Style Switch */
      ha-switch {
        --mdc-theme-secondary: var(--switch-checked-color, var(--primary-color));
      }
      .ha-switch-container {
        display: flex;
        align-items: center;
      }
      .time-picker {
        display: flex;
        justify-content: center;
        gap: 16px;
      }
      .time-section {
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .time-display {
        font-size: 2em;
        font-weight: 400;
        margin: 4px 0;
        line-height: 1.2;
      }
      button {
        background: none;
        border: none;
        color: var(--primary-text-color);
        font-size: 1.5em;
        cursor: pointer;
        padding: 0;
        height: 24px;
        width: 24px;
        line-height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      button:focus {
        outline: none;
      }
      .dropdown {
        background: var(--card-background-color);
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 4px;
        padding: 4px 8px;
        color: var(--primary-text-color);
        font-size: 14px;
        height: 32px;
        width: 100%;
        min-width: 220px; /* Dropdown noch größer machen */
      }
      .result-display {
        font-weight: 500;
      }
      .result-row {
        margin-top: 8px;
      }
      .best-price-display {
        font-size: 1.1em;
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
    `%c andiwirs/ha-home-appliance-timer-card %c v1.0.1 `
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