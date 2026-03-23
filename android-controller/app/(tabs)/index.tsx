import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, PanResponder, TextInput, SafeAreaView, Pressable, Alert, Modal, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';

export default function ControllerScreen() {
  const [ip, setIp] = useState('192.168.0.122');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [isFlipped, setIsFlipped] = useState(false);
  const [targetDevice, setTargetDevice] = useState<'laptop'|'tv'>('laptop');
  const [tvIp, setTvIp] = useState('');
  
  const [mouseSens, setMouseSens] = useState(1.0);
  const [scrollSens, setScrollSens] = useState(1.0);
  
  const ws = useRef<WebSocket | null>(null);
  const [clickSound, setClickSound] = useState<Audio.Sound | null>(null);

  const leftPan = useRef(new Animated.ValueXY()).current;
  const rightPan = useRef(new Animated.ValueXY()).current;
  
  const ZWS = '\u200B';
  const keyboardRef = useRef<TextInput>(null);
  const [hiddenText, setHiddenText] = useState(ZWS);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const virtualCursorPos = useRef(1);
  const userTapped = useRef(false);

  useEffect(() => {
    async function loadSound() {
      try {
        const { sound } = await Audio.Sound.createAsync(
           { uri: 'https://www.soundjay.com/buttons/sounds/button-16.mp3' }
        );
        setClickSound(sound);
      } catch (e) {}
    }
    loadSound();
    return () => { clickSound?.unloadAsync(); };
  }, []);

  const playFeedback = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (clickSound) { try { await clickSound.replayAsync(); } catch (e) {} }
  };

  const connectWs = () => {
    if (ws.current) ws.current.close();
    setConnecting(true);
    const cleanIp = ip.trim();
    const socket = new WebSocket(`ws://${cleanIp}:8765`);
    
    socket.onopen = () => { 
      setConnected(true); 
      setConnecting(false);
      setSettingsOpen(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };
    socket.onclose = () => { setConnected(false); setConnecting(false); };
    socket.onerror = () => { 
      setConnected(false); 
      setConnecting(false);
      Alert.alert('Грешка при връзката', `Неуспешно свързване към ${cleanIp}. Проверете IP адреса и мрежата.`);
    };
    ws.current = socket;
  };

  useEffect(() => {
    const timer = setTimeout(() => { connectWs(); }, 500);
    return () => clearTimeout(timer);
  }, []);

  const sendCommand = (cmd: any) => {
    if (ws.current && connected) {
       ws.current.send(JSON.stringify({ ...cmd, target: targetDevice, tvIp: tvIp.trim() }));
    }
  };

  const btnDown = (action: string) => { playFeedback(); sendCommand({ type: 'button', action, state: 'down' }); };
  const btnUp = (action: string) => sendCommand({ type: 'button', action, state: 'up' });
  const btnPress = (action: string) => { playFeedback(); sendCommand({ type: 'button', action, state: 'press' }); };

  const autoRepeatTimer = useRef<NodeJS.Timeout | null>(null);
  const autoRepeatInterval = useRef<NodeJS.Timeout | null>(null);

  const startAutoRepeat = (action: string) => {
      btnPress(action);
      if (autoRepeatTimer.current) clearTimeout(autoRepeatTimer.current);
      if (autoRepeatInterval.current) clearInterval(autoRepeatInterval.current);
      autoRepeatTimer.current = setTimeout(() => {
          autoRepeatInterval.current = setInterval(() => {
              sendCommand({ type: 'button', action, state: 'press' });
          }, 45);
      }, 400);
  };

  const stopAutoRepeat = () => {
      if (autoRepeatTimer.current) clearTimeout(autoRepeatTimer.current);
      if (autoRepeatInterval.current) clearInterval(autoRepeatInterval.current);
  };

  const handleTextChange = (text: string) => {
    let preLen = 0;
    const minLen = Math.min(hiddenText.length, text.length);
    while (preLen < minLen && hiddenText[preLen] === text[preLen]) {
       preLen++;
    }
    
    let sufLen = 0;
    const maxSuf = minLen - preLen;
    while (sufLen < maxSuf && hiddenText[hiddenText.length - 1 - sufLen] === text[text.length - 1 - sufLen]) {
       sufLen++;
    }
    
    const removedCount = hiddenText.length - preLen - sufLen;
    const targetCursorPos = preLen + removedCount;
    
    const diff = targetCursorPos - virtualCursorPos.current;
    if (diff > 0) {
        for(let i=0; i<diff; i++) sendCommand({ type: 'button', action: 'RIGHT', state: 'press' });
    } else if (diff < 0) {
        for(let i=0; i<-diff; i++) sendCommand({ type: 'button', action: 'LEFT', state: 'press' });
    }
    
    virtualCursorPos.current = targetCursorPos;

    for (let i = 0; i < removedCount; i++) {
        sendCommand({ type: 'type_key', key: 'Backspace' });
        virtualCursorPos.current--;
    }
    
    const addedStr = text.substring(preLen, text.length - sufLen);
    for (let i = 0; i < addedStr.length; i++) {
        sendCommand({ type: 'type_key', key: addedStr[i] === '\n' ? 'Enter' : addedStr[i] });
        virtualCursorPos.current++;
    }
    
    if (text === '') {
        setHiddenText(ZWS);
        virtualCursorPos.current = 1;
    } else {
        setHiddenText(text);
    }
  };

  const handleSelectionChange = (e: any) => {
      const newPos = e.nativeEvent.selection.start;
      const oldPos = virtualCursorPos.current;
      
      if (userTapped.current && newPos !== oldPos) {
          const diff = newPos - oldPos;
          if (diff > 0) {
              for(let i=0; i<diff; i++) sendCommand({ type: 'button', action: 'RIGHT', state: 'press' });
          } else if (diff < 0) {
              for(let i=0; i<-diff; i++) sendCommand({ type: 'button', action: 'LEFT', state: 'press' });
          }
          virtualCursorPos.current = newPos;
      }
  };

  const leftResponder = React.useMemo(() => {
    let lastTapEndTime = 0;
    let isDraggingGesture = false;
    let currentTapStartTime = 0;
    
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        currentTapStartTime = Date.now();
        if (currentTapStartTime - lastTapEndTime < 350) {
           isDraggingGesture = true;
           playFeedback();
           sendCommand({ type: 'button', action: 'L3', state: 'down' });
        } else {
           isDraggingGesture = false;
        }
        
        leftPan.setOffset({ x: (leftPan.x as any)._value, y: (leftPan.y as any)._value });
        leftPan.setValue({ x: 0, y: 0 });
        sendCommand({ type: 'joystick_left', dx: 0, dy: 0 });
      },
      onPanResponderMove: (evt, gestureState) => {
        const vr = 34; 
        let dx = gestureState.dx, dy = gestureState.dy, d = Math.sqrt(dx*dx + dy*dy);
        let vdx = dx, vdy = dy;
        if (d > vr) { vdx = dx*(vr/d); vdy = dy*(vr/d); }
        leftPan.setValue({ x: vdx, y: vdy });
        
        sendCommand({ type: 'joystick_left', dx: dx * mouseSens, dy: dy * mouseSens });
      },
      onPanResponderRelease: (evt, gestureState) => {
        leftPan.flattenOffset();
        Animated.spring(leftPan, { toValue: { x: 0, y: 0 }, friction: 4, tension: 70, useNativeDriver: false }).start();
        sendCommand({ type: 'joystick_left', dx: 0, dy: 0 });
        
        const now = Date.now();
        if (isDraggingGesture) {
            sendCommand({ type: 'button', action: 'L3', state: 'up' });
            isDraggingGesture = false;
        } else {
            if (Math.abs(gestureState.dx) < 10 && Math.abs(gestureState.dy) < 10 && (now - currentTapStartTime) < 300) {
               btnPress('L3');
               lastTapEndTime = now;
            } else {
               lastTapEndTime = 0;
            }
        }
      }
    });
  }, [connected, mouseSens]);

  const rightResponder = React.useMemo(() => {
    let lastTapEndTime = 0;
    let isDraggingGesture = false;
    let currentTapStartTime = 0;
    
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        currentTapStartTime = Date.now();
        if (currentTapStartTime - lastTapEndTime < 350) {
           isDraggingGesture = true;
           playFeedback();
           sendCommand({ type: 'button', action: 'R3', state: 'down' });
        } else {
           isDraggingGesture = false;
        }
        
        rightPan.setOffset({ x: (rightPan.x as any)._value, y: (rightPan.y as any)._value });
        rightPan.setValue({ x: 0, y: 0 });
        sendCommand({ type: 'joystick_right', dx: 0, dy: 0 });
      },
      onPanResponderMove: (evt, gestureState) => {
        const vr = 34; 
        let dx = gestureState.dx, dy = gestureState.dy, d = Math.sqrt(dx*dx + dy*dy);
        let vdx = dx, vdy = dy;
        if (d > vr) { vdx = dx*(vr/d); vdy = dy*(vr/d); }
        rightPan.setValue({ x: vdx, y: vdy });
        
        sendCommand({ type: 'joystick_right', dx: dx * scrollSens, dy: dy * scrollSens });
      },
      onPanResponderRelease: (evt, gestureState) => {
        rightPan.flattenOffset();
        Animated.spring(rightPan, { toValue: { x: 0, y: 0 }, friction: 4, tension: 70, useNativeDriver: false }).start();
        sendCommand({ type: 'joystick_right', dx: 0, dy: 0 });
        
        const now = Date.now();
        if (isDraggingGesture) {
            sendCommand({ type: 'button', action: 'R3', state: 'up' });
            isDraggingGesture = false;
        } else {
            if (Math.abs(gestureState.dx) < 10 && Math.abs(gestureState.dy) < 10 && (now - currentTapStartTime) < 300) {
               btnPress('R3');
               lastTapEndTime = now;
            } else {
               lastTapEndTime = 0;
            }
        }
      }
    });
  }, [connected, scrollSens]);

  return (
    <SafeAreaView style={styles.wrapper}>
      <View style={[styles.keyboardContainer, { top: showKeyboard ? 20 : -2000, opacity: showKeyboard ? 1 : 0 }]}>
        <TextInput 
          ref={keyboardRef}
          style={styles.visibleTextInput}
          value={hiddenText}
          onChangeText={handleTextChange}
          onSelectionChange={handleSelectionChange}
          onTouchStart={() => { userTapped.current = true; }}
          onTouchEnd={() => { setTimeout(() => { userTapped.current = false; }, 300); }}
          placeholder="Пишете текст тук..."
          placeholderTextColor="#666"
          onBlur={() => { setShowKeyboard(false); setHiddenText(ZWS); virtualCursorPos.current = 1; }}
          multiline={true}
          blurOnSubmit={false}
        />
        <View style={{flexDirection: 'row', gap: 10, marginLeft: 15}}>
            <Pressable style={styles.clearTextBtn} onPress={() => { setHiddenText(ZWS); virtualCursorPos.current = 1; }}>
               <Text style={styles.clearTextBtnText}>Изчисти</Text>
            </Pressable>
            <Pressable style={[styles.clearTextBtn, {backgroundColor: '#262A33', borderColor: '#4A505C', borderWidth: 1}]} onPress={() => { keyboardRef.current?.blur(); setShowKeyboard(false); }}>
               <Text style={styles.clearTextBtnText}>Скрий</Text>
            </Pressable>
        </View>
      </View>

      <Modal visible={settingsOpen} animationType="slide" transparent={true}>
         <View style={styles.modalOverlay}>
            <View style={styles.settingsPanelFull}>
               <Text style={styles.modalTitle}>НАСТРОЙКИ</Text>
               <View style={{flexDirection:'row', gap:10}}>
                   <View style={[styles.inputRow, {flex: 1}]}>
                     <Text style={styles.inputLabel}>IP АДРЕС (ЛАПТОП):</Text>
                     <TextInput style={styles.inputFull} value={ip} onChangeText={setIp} keyboardType="default" placeholder="Трябва за връзка" placeholderTextColor="#555" />
                   </View>
                   <View style={[styles.inputRow, {flex: 1}]}>
                     <Text style={styles.inputLabel}>IP АДРЕС (ТЕЛЕВИЗОР):</Text>
                     <TextInput style={styles.inputFull} value={tvIp} onChangeText={setTvIp} keyboardType="default" placeholder="За TV режим" placeholderTextColor="#555" />
                   </View>
               </View>
               <View style={{flexDirection:'row', gap:10}}>
                   <View style={[styles.inputRow, {flex:1}]}>
                     <Text style={styles.inputLabel}>МИШЕНА (РЕЖИМ):</Text>
                     <Pressable onPress={() => { playFeedback(); setTargetDevice(t => t === 'laptop' ? 'tv' : 'laptop'); }} style={({pressed}) => [{ backgroundColor: targetDevice === 'tv' ? '#FA5C38' : '#21242D', padding: 8, borderRadius: 8, borderWidth: 1, borderColor: '#3A3F49', alignItems: 'center' }, pressed && {opacity:0.7}]}>
                        <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>
                           {targetDevice === 'laptop' ? '💻 ЛАПТОП' : '📺 ТЕЛЕВИЗОР'}
                        </Text>
                     </Pressable>
                   </View>
                   <View style={[styles.inputRow, {flex:1}]}>
                     <Text style={styles.inputLabel}>ПОЗИЦИЯ ЗА РЪКАТА:</Text>
                     <Pressable onPress={() => { playFeedback(); setIsFlipped(!isFlipped); }} style={({pressed}) => [{ backgroundColor: '#21242D', padding: 8, borderRadius: 8, borderWidth: 1, borderColor: '#3A3F49', alignItems: 'center' }, pressed && {opacity:0.7}]}>
                        <Text style={{ color: '#FA5C38', fontSize: 13, fontWeight: 'bold' }}>
                           {isFlipped ? 'ОБЪРНАТА (Лява)' : 'СТАНДАРТ (Дясна)'}
                        </Text>
                     </Pressable>
                   </View>
               </View>
               {targetDevice === 'laptop' && (
                 <View style={styles.slidersRowFull}>
                 <View style={styles.sliderBlockFull}>
                    <Text style={styles.sliderLabelFull}>СКОРОСТ МИШКА ({mouseSens.toFixed(1)}x)</Text>
                    <View style={styles.stepperFull}>
                       <Pressable onPress={() => { playFeedback(); setMouseSens(s => Math.max(0.2, s - 0.2))}} style={({pressed}) => [styles.stepBtnFull, pressed && styles.pressedSmall]}><Text style={styles.stepTextFull}>-</Text></Pressable>
                       <Pressable onPress={() => { playFeedback(); setMouseSens(s => Math.min(5.0, s + 0.2))}} style={({pressed}) => [styles.stepBtnFull, pressed && styles.pressedSmall]}><Text style={styles.stepTextFull}>+</Text></Pressable>
                    </View>
                 </View>
                 <View style={styles.sliderBlockFull}>
                    <Text style={styles.sliderLabelFull}>СКОРОСТ СКРОЛ ({scrollSens.toFixed(1)}x)</Text>
                    <View style={styles.stepperFull}>
                       <Pressable onPress={() => { playFeedback(); setScrollSens(s => Math.max(0.2, s - 0.2))}} style={({pressed}) => [styles.stepBtnFull, pressed && styles.pressedSmall]}><Text style={styles.stepTextFull}>-</Text></Pressable>
                       <Pressable onPress={() => { playFeedback(); setScrollSens(s => Math.min(5.0, s + 0.2))}} style={({pressed}) => [styles.stepBtnFull, pressed && styles.pressedSmall]}><Text style={styles.stepTextFull}>+</Text></Pressable>
                     </View>
                  </View>
               </View>
               )}
               <View style={styles.modalActions}>
                  <Pressable style={({pressed}) => [styles.connectBtnFull, connected && styles.connectBtnActiveFull, pressed && {opacity: 0.7}]} onPress={connectWs}>
                    <Text style={styles.connectBtnTextFull}>{connected ? 'СВЪРЗАН (READY)' : connecting ? 'СВЪРЗВАНЕ...' : 'СВЪРЗВАНЕ'}</Text>
                  </Pressable>
                  <Pressable style={({pressed}) => [styles.closeBtnFull, pressed && {opacity: 0.7}]} onPress={() => setSettingsOpen(false)}>
                    <Text style={styles.closeBtnTextFull}>ИГРАЙ</Text>
                  </Pressable>
               </View>
            </View>
         </View>
      </Modal>

      <View style={styles.shoulderRow}>
         <View style={styles.shoulderGroup}>
            <Pressable style={({pressed}) => [styles.triggerBtn, pressed && styles.pressedTrigger]} onPressIn={() => btnDown('L2')} onPressOut={() => btnUp('L2')}><Text style={styles.shoulderText}>L2</Text></Pressable>
            <Pressable style={({pressed}) => [styles.bumperBtn, pressed && styles.pressedBumper]} onPressIn={() => btnDown('L1')} onPressOut={() => btnUp('L1')}><Text style={styles.shoulderText}>L1</Text></Pressable>
         </View>
         <View style={styles.shoulderGroup}>
            <Pressable style={({pressed}) => [styles.bumperBtn, pressed && styles.pressedBumper]} onPressIn={() => btnDown('R1')} onPressOut={() => btnUp('R1')}><Text style={styles.shoulderText}>R1</Text></Pressable>
            <Pressable style={({pressed}) => [styles.triggerBtn, pressed && styles.pressedTrigger]} onPressIn={() => btnDown('R2')} onPressOut={() => btnUp('R2')}><Text style={styles.shoulderText}>R2</Text></Pressable>
         </View>
      </View>

      <View style={styles.faceArea}>
        <View style={styles.leftCol}>
          {!isFlipped ? (
             <>
                <View style={styles.dpadWrapper}>
                  <View style={styles.dpadCross}>
                    <Pressable style={({pressed}) => [styles.dpadBtn, styles.dpadUp, pressed && styles.pressedDpad]} hitSlop={25} pressRetentionOffset={100} delayPressOut={0} delayPressIn={0} onPressIn={() => startAutoRepeat('UP')} onPressOut={stopAutoRepeat} />
                    <Pressable style={({pressed}) => [styles.dpadBtn, styles.dpadLeft, pressed && styles.pressedDpad]} hitSlop={25} pressRetentionOffset={100} delayPressOut={0} delayPressIn={0} onPressIn={() => startAutoRepeat('LEFT')} onPressOut={stopAutoRepeat} />
                    <Pressable style={({pressed}) => [styles.dpadBtn, styles.dpadRight, pressed && styles.pressedDpad]} hitSlop={25} pressRetentionOffset={100} delayPressOut={0} delayPressIn={0} onPressIn={() => startAutoRepeat('RIGHT')} onPressOut={stopAutoRepeat} />
                    <Pressable style={({pressed}) => [styles.dpadBtn, styles.dpadDown, pressed && styles.pressedDpad]} hitSlop={25} pressRetentionOffset={100} delayPressOut={0} delayPressIn={0} onPressIn={() => startAutoRepeat('DOWN')} onPressOut={stopAutoRepeat} />
                    <View style={styles.dpadCenter} />
                  </View>
                </View>
                <View style={[styles.joystickBase, { alignSelf: 'flex-end', marginTop: 10 }]} {...leftResponder.panHandlers}>
                  <Animated.View style={[styles.joystickStick, leftPan.getLayout()]}>
                    <View style={styles.stickDimple}><View style={styles.stickGrip} /></View>
                  </Animated.View>
                </View>
             </>
          ) : (
             <>
                <View style={[styles.abxyWrapper, { alignSelf: 'flex-start', marginLeft: 20, marginRight: 0 }]}>
                  <Pressable style={({pressed}) => [styles.abxyBtn, styles.btnY, pressed && styles.pressedAbxy]} onPressIn={() => btnDown('Y')} onPressOut={() => btnUp('Y')}><Text style={[styles.abxyText, {color:'#FBBC05'}]}>Y</Text></Pressable>
                  <Pressable style={({pressed}) => [styles.abxyBtn, styles.btnX, pressed && styles.pressedAbxy]} onPressIn={() => btnDown('X')} onPressOut={() => btnUp('X')}><Text style={[styles.abxyText, {color:'#4285F4'}]}>X</Text></Pressable>
                  <Pressable style={({pressed}) => [styles.abxyBtn, styles.btnB, pressed && styles.pressedAbxy]} onPressIn={() => btnDown('B')} onPressOut={() => btnUp('B')}><Text style={[styles.abxyText, {color:'#EA4335'}]}>B</Text></Pressable>
                  <Pressable style={({pressed}) => [styles.abxyBtn, styles.btnA, pressed && styles.pressedAbxy]} onPressIn={() => btnDown('A')} onPressOut={() => btnUp('A')}><Text style={[styles.abxyText, {color:'#34A853'}]}>A</Text></Pressable>
                </View>
                <View style={[styles.joystickBase, { alignSelf: 'flex-end', marginTop: 10 }]} {...rightResponder.panHandlers}>
                  <Animated.View style={[styles.joystickStick, rightPan.getLayout()]}>
                    <View style={styles.stickDimple}><View style={styles.stickGrip} /></View>
                  </Animated.View>
                </View>
             </>
          )}
        </View>

        <View style={styles.centerCol}>
           <View style={styles.systemRowTop}>
              <Pressable style={({pressed}) => [styles.smallBtn, pressed && styles.pressedSmall]} onPress={() => btnPress('MENU')}><Text style={styles.smallBtnText}>≡</Text></Pressable>
              <Pressable style={({pressed}) => [styles.stadiaBtnSys, pressed && styles.pressedStadiaSys]} onPress={() => { playFeedback(); setSettingsOpen(true); }}><View style={[styles.stadiaDot, connected && {backgroundColor: '#FA5C38'}]} /></Pressable>
              <Pressable style={({pressed}) => [styles.smallBtn, pressed && styles.pressedSmall]} onPress={() => btnPress('OPTIONS')}><Text style={styles.smallBtnText}>⋯</Text></Pressable>
           </View>
           <View style={styles.systemRowBottom}>
              <Pressable style={({pressed}) => [styles.smallBtn, pressed && styles.pressedSmall]} onPress={() => btnPress('ASSISTANT')}><Text style={styles.smallBtnText}>●</Text></Pressable>
              <Pressable style={({pressed}) => [styles.smallBtn, pressed && styles.pressedSmall]} onPress={() => { 
                playFeedback(); 
                setShowKeyboard(true);
                if (keyboardRef.current) {
                   keyboardRef.current.blur();
                   setTimeout(() => keyboardRef.current?.focus(), 150);
                }
              }}>
                <Text style={styles.smallBtnText}>⌨</Text>
              </Pressable>
           </View>
        </View>

        <View style={styles.rightCol}>
          {!isFlipped ? (
             <>
                <View style={styles.abxyWrapper}>
                  <Pressable style={({pressed}) => [styles.abxyBtn, styles.btnY, pressed && styles.pressedAbxy]} onPressIn={() => btnDown('Y')} onPressOut={() => btnUp('Y')}><Text style={[styles.abxyText, {color:'#FBBC05'}]}>Y</Text></Pressable>
                  <Pressable style={({pressed}) => [styles.abxyBtn, styles.btnX, pressed && styles.pressedAbxy]} onPressIn={() => btnDown('X')} onPressOut={() => btnUp('X')}><Text style={[styles.abxyText, {color:'#4285F4'}]}>X</Text></Pressable>
                  <Pressable style={({pressed}) => [styles.abxyBtn, styles.btnB, pressed && styles.pressedAbxy]} onPressIn={() => btnDown('B')} onPressOut={() => btnUp('B')}><Text style={[styles.abxyText, {color:'#EA4335'}]}>B</Text></Pressable>
                  <Pressable style={({pressed}) => [styles.abxyBtn, styles.btnA, pressed && styles.pressedAbxy]} onPressIn={() => btnDown('A')} onPressOut={() => btnUp('A')}><Text style={[styles.abxyText, {color:'#34A853'}]}>A</Text></Pressable>
                </View>
                <View style={[styles.joystickBase, { alignSelf: 'flex-start', marginTop: 10 }]} {...rightResponder.panHandlers}>
                  <Animated.View style={[styles.joystickStick, rightPan.getLayout()]}>
                    <View style={styles.stickDimple}><View style={styles.stickGrip} /></View>
                  </Animated.View>
                </View>
             </>
          ) : (
             <>
                <View style={[styles.dpadWrapper, { alignSelf: 'flex-end', marginRight: 20, marginLeft: 0 }]}>
                  <View style={styles.dpadCross}>
                    <Pressable style={({pressed}) => [styles.dpadBtn, styles.dpadUp, pressed && styles.pressedDpad]} hitSlop={25} pressRetentionOffset={100} delayPressOut={0} delayPressIn={0} onPressIn={() => startAutoRepeat('UP')} onPressOut={stopAutoRepeat} />
                    <Pressable style={({pressed}) => [styles.dpadBtn, styles.dpadLeft, pressed && styles.pressedDpad]} hitSlop={25} pressRetentionOffset={100} delayPressOut={0} delayPressIn={0} onPressIn={() => startAutoRepeat('LEFT')} onPressOut={stopAutoRepeat} />
                    <Pressable style={({pressed}) => [styles.dpadBtn, styles.dpadRight, pressed && styles.pressedDpad]} hitSlop={25} pressRetentionOffset={100} delayPressOut={0} delayPressIn={0} onPressIn={() => startAutoRepeat('RIGHT')} onPressOut={stopAutoRepeat} />
                    <Pressable style={({pressed}) => [styles.dpadBtn, styles.dpadDown, pressed && styles.pressedDpad]} hitSlop={25} pressRetentionOffset={100} delayPressOut={0} delayPressIn={0} onPressIn={() => startAutoRepeat('DOWN')} onPressOut={stopAutoRepeat} />
                    <View style={styles.dpadCenter} />
                  </View>
                </View>
                <View style={[styles.joystickBase, { alignSelf: 'flex-start', marginTop: 10 }]} {...leftResponder.panHandlers}>
                  <Animated.View style={[styles.joystickStick, leftPan.getLayout()]}>
                    <View style={styles.stickDimple}><View style={styles.stickGrip} /></View>
                  </Animated.View>
                </View>
             </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#1C1F26' }, 
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
  settingsPanelFull: { width: '85%', maxWidth: 600, backgroundColor: '#181A20', borderRadius: 20, padding: 15, borderWidth: 2, borderColor: '#FA5C38', elevation: 20 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 10, letterSpacing: 2 },
  inputRow: { marginBottom: 10 },
  inputLabel: { color: '#888', fontSize: 11, fontWeight: 'bold', marginBottom: 4 },
  inputFull: { backgroundColor: '#121418', color: '#fff', fontSize: 16, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: '#3A3F49' },
  slidersRowFull: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#121418', padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#262A33', marginBottom: 15 },
  sliderBlockFull: { flex: 1, alignItems: 'center' },
  sliderLabelFull: { color: '#FA5C38', fontSize: 12, marginBottom: 8, fontWeight: '900', letterSpacing: 1 },
  stepperFull: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  stepBtnFull: { width: 40, height: 40, backgroundColor: '#2C303A', borderRadius: 20, justifyContent: 'center', alignItems: 'center', elevation: 5, borderTopWidth: 2, borderBottomWidth: 4, borderLeftWidth: 2, borderRightWidth: 2, borderTopColor: '#5C6370', borderBottomColor: '#0A0B0E', borderLeftColor: '#1F2229', borderRightColor: '#1F2229' },
  stepTextFull: { color: '#fff', fontSize: 24, fontWeight: 'bold', marginTop: -2 },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  connectBtnFull: { flex: 1.5, backgroundColor: '#3A3F49', paddingVertical: 10, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  connectBtnActiveFull: { backgroundColor: '#FA5C38' },
  connectBtnTextFull: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  closeBtnFull: { flex: 1, backgroundColor: '#21242D', paddingVertical: 10, borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#3A3F49' },
  closeBtnTextFull: { color: '#aaa', fontSize: 14, fontWeight: 'bold' },

  shoulderRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 40, paddingTop: 10, zIndex: 10 },
  shoulderGroup: { flexDirection: 'row', gap: 15 },
  bumperBtn: { width: 90, height: 42, backgroundColor: '#2C303A', borderRadius: 8, justifyContent: 'center', alignItems: 'center', elevation: 6, borderTopWidth: 2, borderBottomWidth: 5, borderLeftWidth: 2, borderRightWidth: 2, borderTopColor: '#5C6370', borderBottomColor: '#0A0B0E', borderLeftColor: '#1F2229', borderRightColor: '#1F2229' },
  triggerBtn: { width: 90, height: 50, backgroundColor: '#21242D', borderRadius: 12, justifyContent: 'center', alignItems: 'center', elevation: 8, borderTopWidth: 2, borderBottomWidth: 8, borderLeftWidth: 2, borderRightWidth: 2, borderTopColor: '#3E4452', borderBottomColor: '#000000', borderLeftColor: '#101215', borderRightColor: '#101215', marginTop: -15 },
  shoulderText: { color: '#888', fontWeight: 'bold', fontSize: 16 },

  faceArea: { flex: 1, flexDirection: 'row', paddingHorizontal: 20, paddingTop: 10 },
  leftCol: { flex: 1.5, justifyContent: 'space-between', paddingBottom: 25 },
  centerCol: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 30 },
  rightCol: { flex: 1.5, justifyContent: 'space-between', paddingBottom: 25 },

  dpadWrapper: { width: 140, height: 140, alignSelf: 'flex-start', marginLeft: 20, position: 'relative' },
  dpadCross: { width: 140, height: 140, elevation: 12, shadowColor: '#000', shadowOffset: {width: 0, height: 10}, shadowOpacity: 0.8, shadowRadius: 10 },
  dpadBtn: { position: 'absolute', backgroundColor: '#262A33', width: 46, height: 46, borderTopWidth: 1.5, borderBottomWidth: 6, borderLeftWidth: 1.5, borderRightWidth: 1.5, borderTopColor: '#4A505C', borderBottomColor: '#0A0B0E', borderLeftColor: '#181A20', borderRightColor: '#181A20' },
  dpadUp: { top: 0, left: 47, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  dpadDown: { bottom: 0, left: 47, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  dpadLeft: { top: 47, left: 0, borderTopLeftRadius: 8, borderBottomLeftRadius: 8 },
  dpadRight: { top: 47, right: 0, borderTopRightRadius: 8, borderBottomRightRadius: 8 },
  dpadCenter: { position: 'absolute', top: 47, left: 47, width: 46, height: 46, backgroundColor: '#262A33', borderTopWidth: 0, borderBottomWidth: 4, borderLeftWidth: 0, borderRightWidth: 0, borderBottomColor: '#0A0B0E' },

  joystickBase: { width: 154, height: 154, borderRadius: 77, backgroundColor: '#13151A', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#FA5C38', elevation: 15, shadowColor: '#FA5C38', shadowOpacity: 0.6, shadowRadius: 15 },
  joystickStick: { width: 86, height: 86, borderRadius: 43, backgroundColor: '#2C303A', justifyContent: 'center', alignItems: 'center', elevation: 20, shadowColor: '#000', shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: {width:0, height:8}, borderTopWidth: 2, borderBottomWidth: 6, borderLeftWidth: 2, borderRightWidth: 2, borderTopColor: '#606775', borderBottomColor: '#0A0C0F', borderLeftColor: '#1F2229', borderRightColor: '#1F2229' },
  stickDimple: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#21242D', shadowColor: '#000', shadowOpacity: 0.8, shadowRadius: 4, shadowOffset: {width:0, height: -3}, justifyContent: 'center', alignItems: 'center' },
  stickGrip: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: '#111', borderStyle: 'dotted' },

  systemRowTop: { flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 25 },
  systemRowBottom: { flexDirection: 'row', gap: 20 },
  smallBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#2C303A', justifyContent: 'center', alignItems: 'center', elevation: 6, borderTopWidth: 1.5, borderBottomWidth: 4, borderLeftWidth: 1.5, borderRightWidth: 1.5, borderTopColor: '#5C6370', borderBottomColor: '#0A0B0E', borderLeftColor: '#1F2229', borderRightColor: '#1F2229' },
  smallBtnText: { color: '#ccc', fontSize: 18, fontWeight: 'bold' },
  stadiaBtnSys: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#1B1E25', justifyContent: 'center', alignItems: 'center', elevation: 8, borderTopWidth: 2, borderBottomWidth: 5, borderLeftWidth: 2, borderRightWidth: 2, borderTopColor: '#3A3F49', borderBottomColor: '#000', borderLeftColor: '#111', borderRightColor: '#111' },
  stadiaDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#444' },

  abxyWrapper: { width: 160, height: 160, alignSelf: 'flex-end', marginRight: 20, position: 'relative' },
  abxyBtn: { position: 'absolute', width: 54, height: 54, borderRadius: 27, backgroundColor: '#2C303A', justifyContent: 'center', alignItems: 'center', elevation: 10, shadowColor: '#000', shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.8, shadowRadius: 8, borderTopWidth: 2, borderBottomWidth: 5, borderLeftWidth: 2, borderRightWidth: 2, borderTopColor: '#5C6370', borderBottomColor: '#0A0B0E', borderLeftColor: '#1F2229', borderRightColor: '#1F2229' },
  abxyText: { fontSize: 24, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: {width: 0, height: 2}, textShadowRadius: 3 },
  btnY: { top: 0, left: 53 },
  btnX: { top: 53, left: 0 },
  btnB: { top: 53, right: 0 },
  btnA: { bottom: 0, left: 53 },

  keyboardContainer: { position: 'absolute', left: 40, right: 40, height: 50, backgroundColor: '#1B1E25', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, zIndex: 110, borderRadius: 12, borderWidth: 1.5, borderColor: '#FA5C38', elevation: 15, shadowColor: '#000', shadowOpacity: 0.8, shadowRadius: 10 },
  visibleTextInput: { flex: 1, color: '#fff', fontSize: 16, backgroundColor: '#121418', borderRadius: 6, paddingHorizontal: 15, height: 36, borderWidth: 1, borderColor: '#3A3F49' },
  clearTextBtn: { backgroundColor: '#3A3F49', paddingHorizontal: 15, height: 36, justifyContent: 'center', borderRadius: 6, elevation: 4 },
  clearTextBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },

  /* --- 3D PRESS ANIMATIONS --- */
  pressedAbxy: { borderBottomWidth: 1, borderTopWidth: 1, transform: [{ translateY: 4 }], elevation: 4 },
  pressedDpad: { borderBottomWidth: 1.5, borderTopWidth: 1, transform: [{ translateY: 4.5 }] },
  pressedSmall: { borderBottomWidth: 1, transform: [{ translateY: 3 }], elevation: 2 },
  pressedStadiaSys: { borderBottomWidth: 1, borderTopWidth: 1, transform: [{ translateY: 4 }], elevation: 3 },
  pressedTrigger: { borderBottomWidth: 3, borderTopWidth: 1, transform: [{ translateY: 5 }], elevation: 4 },
  pressedBumper: { borderBottomWidth: 1, borderTopWidth: 1, transform: [{ translateY: 4 }], elevation: 3 }
});
