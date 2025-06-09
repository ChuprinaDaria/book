// popup.js - Оптимізована версія з інтегрованою функцією отримання даних

document.getElementById("start-btn").addEventListener("click", async () => {
  const inputDate = document.getElementById("slot-date").value;

  if (!inputDate) {
    alert("⛔ Введи дату перед стартом");
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: runSlotHunter,
      args: [inputDate]
    });
  });
});

async function runSlotHunter(dateInput) {
  // === СИСТЕМА ЛОГУВАННЯ ===
  const Logger = {
    log: (level, message, data = null) => {
      const timestamp = new Date().toLocaleTimeString('uk-UA');
      const prefix = {
        INFO: '📋',
        SUCCESS: '✅',
        WARNING: '⚠️',
        ERROR: '❌',
        DEBUG: '🔍'
      }[level] || '📝';
      
      console.log(`${prefix} [${timestamp}] ${message}`);
      if (data) {
        console.log('   📊 Дані:', data);
      }
    },
    
    info: (msg, data) => Logger.log('INFO', msg, data),
    success: (msg, data) => Logger.log('SUCCESS', msg, data),
    warn: (msg, data) => Logger.log('WARNING', msg, data),
    error: (msg, data) => Logger.log('ERROR', msg, data),
    debug: (msg, data) => Logger.log('DEBUG', msg, data)
  };

  // === ІНІЦІАЛІЗАЦІЯ ===
  Logger.info(`🚀 Запуск SlotHunter для дати: ${dateInput}`);
  
  const accessToken = Object.values(sessionStorage).find(v => v && v.startsWith && v.startsWith("eyJ"));
  if (!accessToken) {
    Logger.error("Токен не знайдено в sessionStorage");
    alert("❌ Токен не знайдено! Увійдіть в акаунт на сайті.");
    return;
  }

  // Перевірка токена
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1]));
    const now = Math.floor(Date.now() / 1000);
    const isExpired = payload.exp && payload.exp < now;
    
    Logger.info(`Токен expires: ${new Date(payload.exp * 1000)}`);
    
    if (isExpired) {
      Logger.error("Токен застарів!");
      alert("❌ Токен застарів! Перелогініться.");
      return;
    }
    
    Logger.success("Токен валідний");
  } catch (e) {
    Logger.warn("Не вдалося перевірити токен", e.message);
  }

  // === КОНФІГУРАЦІЯ ===
  const queueIds = [
    "c93674d6-fb24-4a85-9dac-61897dc8f060",
    "f0992a78-802d-40e7-9bd0-c0d8d46a71fd",
    "3ab99932-8e53-4dff-9abf-45b8c6286a99"
  ];

  // === ОТРИМАННЯ ДАНИХ КОРИСТУВАЧА З API ===
  const getUserProfile = async () => {
    try {
      // Отримуємо caseId з URL
      const currentUrl = window.location.href;
      const caseIdMatch = currentUrl.match(/\/cases\/([a-f0-9-]+)/);
      
      if (!caseIdMatch) {
        Logger.error("Не вдалося знайти case ID в URL");
        return { name: null, lastName: null, dateOfBirth: null };
      }
      
      const caseId = caseIdMatch[1];
      Logger.info(`Знайдено case ID: ${caseId}`);
      
      // Інтегрована функція отримання даних
      const response = await fetch(`https://inpol.mazowieckie.pl/api/proceedings/${caseId}`, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/json"
        }
      });
      
      if (!response.ok) {
        Logger.error(`API запит невдалий: ${response.status} ${response.statusText}`);
        return { name: null, lastName: null, dateOfBirth: null };
      }
      
      const json = await response.json();
      Logger.debug("Отримано дані з API:", json);
      
      // Знаходимо об'єкт, що має дані про користувача
      const personData = json?.person || json?.applicant || json?.data?.person || json;
      
      const userInfo = {
        name: personData?.firstName,
        lastName: personData?.surname,
        dateOfBirth: personData?.dateOfBirth?.split("T")[0]
      };
      
      Logger.success("✅ Отримано ПІБ:", userInfo);
      
      // Зберігаємо в глобальну змінну для доступу
      window.userInfo = userInfo;
      
      return userInfo;
      
    } catch (error) {
      Logger.error("Помилка отримання даних з API", error.message);
      return { name: null, lastName: null, dateOfBirth: null };
    }
  };

  const userProfile = await getUserProfile();
  
  // Валідація отриманих даних
  if (!userProfile.name || !userProfile.lastName || !userProfile.dateOfBirth) {
    Logger.error("Не вдалося отримати всі необхідні дані користувача", userProfile);
    alert("❌ Не вдалося знайти дані користувача. Переконайтеся, що ви на сторінці конкретної справи.");
    return;
  }
  
  Logger.success("Дані користувача отримано:", userProfile);

  // === ДОПОМІЖНІ ФУНКЦІЇ ===
  const delay = (ms) => {
    Logger.debug(`Затримка ${ms}мс`);
    return new Promise(resolve => setTimeout(resolve, ms));
  };

  const waitFor = (conditionFn, timeout = 5000, interval = 100) => {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const result = conditionFn();
        if (result) return resolve(result);
        if (Date.now() - start > timeout) {
          Logger.error(`Очікування перевищило ліміт ${timeout}мс`);
          return reject("⏰ Очікування перевищило ліміт");
        }
        setTimeout(check, interval);
      };
      check();
    });
  };

  // === API ФУНКЦІЇ ===
  const getSlots = async (queueId, date, retryCount = 0) => {
    const maxRetries = 3;
    const baseDelay = 1000;
    
    Logger.info(`Запит слотів для queue: ${queueId.slice(-8)}... на дату: ${date}`);
    
    try {
      const requestStart = Date.now();
      
      const res = await fetch(`https://inpol.mazowieckie.pl/api/reservations/queue/${queueId}/${date}/slots`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Origin": "https://inpol.mazowieckie.pl",
          "Referer": "https://inpol.mazowieckie.pl/"
        },
        body: "{}"
      });

      const requestTime = Date.now() - requestStart;
      Logger.debug(`Час запиту: ${requestTime}мс`);

      const text = await res.text();
      
      if (!res.ok) {
        Logger.error(`HTTP ${res.status} ${res.statusText} для queue ${queueId.slice(-8)}`, {
          status: res.status,
          response: text.slice(0, 200),
          headers: Object.fromEntries(res.headers.entries())
        });

        if (res.status === 403) {
          if (retryCount < maxRetries) {
            const delayTime = baseDelay * Math.pow(2, retryCount);
            Logger.warn(`403 помилка. Повтор ${retryCount + 1}/${maxRetries} через ${delayTime}мс`);
            await delay(delayTime);
            return await getSlots(queueId, date, retryCount + 1);
          } else {
            Logger.error("Вичерпано спроби після 403 помилок");
          }
        }
        
        return null;
      }

      try {
        const data = JSON.parse(text);
        
        if (Array.isArray(data)) {
          Logger.success(`Отримано ${data.length} слотів для queue ${queueId.slice(-8)}`);
          if (data.length > 0) {
            Logger.info("Приклад слотів:", data.slice(0, 3).map(s => `${s.date} ${s.time} (ID: ${s.id})`));
          }
        } else {
          Logger.warn("Відповідь не є масивом", data);
        }
        
        return data;
      } catch (parseError) {
        Logger.error(`Помилка парсингу JSON для ${queueId.slice(-8)}`, {
          error: parseError.message,
          response: text.slice(0, 200)
        });
        return null;
      }
    } catch (networkError) {
      Logger.error(`Мережева помилка для ${queueId.slice(-8)}`, {
        error: networkError.message,
        retry: retryCount
      });
      
      if (retryCount < maxRetries) {
        const delayTime = baseDelay * Math.pow(2, retryCount);
        Logger.info(`Повтор через ${delayTime}мс`);
        await delay(delayTime);
        return await getSlots(queueId, date, retryCount + 1);
      }
      
      return null;
    }
  };

  const reserveSlot = async (queueId, slotId) => {
    Logger.info(`Спроба бронювання слоту ${slotId} в queue ${queueId.slice(-8)}`);
    
    try {
      const res = await fetch(`https://inpol.mazowieckie.pl/api/reservations/queue/${queueId}/reserve`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Origin": "https://inpol.mazowieckie.pl",
          "Referer": "https://inpol.mazowieckie.pl/"
        },
        body: JSON.stringify({
          queueId: queueId,
          slotId: slotId,
          name: userProfile.name,
          lastName: userProfile.lastName,
          dateOfBirth: userProfile.dateOfBirth
        })
      });
      
      const result = await res.json();
      
      if (res.ok) {
        Logger.success("Бронювання успішне!", result);
        return { success: true, data: result };
      } else {
        Logger.error("Помилка бронювання", result);
        return { success: false, error: result };
      }
      
    } catch (error) {
      Logger.error("Мережева помилка при бронюванні", error.message);
      throw error;
    }
  };

  const verifyCode = async (code) => {
    Logger.info(`Верифікація 2FA коду: ${code}`);
    
    try {
      const res = await fetch("https://inpol.mazowieckie.pl/api/auth/twoFA/verify", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({ twoFACode: code })
      });
      
      const result = await res.json();
      
      if (result.success) {
        Logger.success("2FA верифікація успішна!");
      } else {
        Logger.error("2FA верифікація невдала", result);
      }
      
      return result;
    } catch (error) {
      Logger.error("Помилка верифікації 2FA", error.message);
      throw error;
    }
  };

  const waitForCodeInput = () => {
    Logger.info("Очікування форми вводу SMS коду...");
    
    return new Promise(resolve => {
      const observer = new MutationObserver(() => {
        const input = document.querySelector('input[formcontrolname="code"]');
        if (input) {
          Logger.success("Форма вводу SMS коду знайдена!");
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      
      // Таймаут для очікування
      setTimeout(() => {
        observer.disconnect();
        Logger.warn("Таймаут очікування форми SMS коду");
        resolve();
      }, 10000);
    });
  };

  // === ГОЛОВНИЙ ЦИКЛ ===
  const maxCycles = 60;
  let successfulReservation = false;
  
  for (let cycle = 1; cycle <= maxCycles && !successfulReservation; cycle++) {
    Logger.info(`🔁 Цикл ${cycle}/${maxCycles}`);
    
    let availableSlots = [];
    
    // Збираємо слоти з усіх черг
    for (const queueId of queueIds) {
      try {
        const slots = await getSlots(queueId, dateInput);
        
        if (slots && Array.isArray(slots) && slots.length > 0) {
          availableSlots.push(...slots.map(slot => ({ ...slot, queueId })));
          Logger.success(`Знайдено ${slots.length} слотів в queue ${queueId.slice(-8)}`);
        }
        
        // Затримка між запитами до різних черг
        await delay(1500);
        
      } catch (error) {
        Logger.error(`Помилка обробки queue ${queueId.slice(-8)}`, error.message);
      }
    }
    
    if (availableSlots.length === 0) {
      Logger.warn(`Немає доступних слотів на ${dateInput} в циклі ${cycle}`);
      await delay(5000);
      continue;
    }
    
    // Випадковий вибір слоту
    const randomSlot = availableSlots[Math.floor(Math.random() * availableSlots.length)];
    Logger.info(`🎯 Обрано випадковий слот: ${randomSlot.date} ${randomSlot.time} в queue ${randomSlot.queueId.slice(-8)}`);
    
    try {
      // Спроба прямого бронювання через API
      Logger.info("Спроба прямого бронювання через API...");
      const reserveResult = await reserveSlot(randomSlot.queueId, randomSlot.id);
      
      if (reserveResult && reserveResult.success) {
        Logger.success("🎉 УСПІШНЕ БРОНЮВАННЯ!", {
          slot: `${randomSlot.date} ${randomSlot.time}`,
          queue: randomSlot.queueId.slice(-8),
          cycle: cycle,
          userProfile: userProfile
        });
        
        alert(`🎉 Успішно заброньовано слот: ${randomSlot.date} ${randomSlot.time}`);
        successfulReservation = true;
        break;
      } else if (reserveResult && reserveResult.error && reserveResult.error.message?.includes('2FA')) {
        // Якщо потрібна 2FA верифікація
        Logger.info("Потрібна 2FA верифікація");
        
        // Очікування SMS форми
        await waitForCodeInput();
        
        // Запит SMS коду
        const smsCode = prompt("📱 Введіть код з SMS:");
        if (!smsCode) {
          Logger.warn("SMS код не введено");
          continue;
        }
        
        // Верифікація
        const verifyResult = await verifyCode(smsCode);
        
        if (verifyResult && verifyResult.success) {
          // Повторна спроба бронювання
          const finalReserveResult = await reserveSlot(randomSlot.queueId, randomSlot.id);
          
          if (finalReserveResult && finalReserveResult.success) {
            Logger.success("🎉 УСПІШНЕ БРОНЮВАННЯ ПІСЛЯ 2FA!", {
              slot: `${randomSlot.date} ${randomSlot.time}`,
              queue: randomSlot.queueId.slice(-8),
              cycle: cycle
            });
            
            alert(`🎉 Успішно заброньовано слот: ${randomSlot.date} ${randomSlot.time}`);
            successfulReservation = true;
            break;
          } else {
            Logger.error("Бронювання невдале навіть після 2FA", finalReserveResult);
          }
        } else {
          Logger.error("2FA верифікація невдала", verifyResult);
        }
      } else {
        Logger.error("Бронювання невдале", reserveResult);
      }
      
    } catch (error) {
      Logger.error(`Помилка в циклі ${cycle}`, error.message);
    }
    
    // Затримка між циклами
    if (cycle < maxCycles) {
      Logger.info("Затримка перед наступним циклом...");
      await delay(5000);
    }
  }
  
  if (!successfulReservation) {
    Logger.error(`🔚 Не вдалося заброньовати слот після ${maxCycles} циклів`);
    alert("❌ Слотів не знайдено після всіх спроб");
  }
  
  Logger.info("SlotHunter завершено");
}