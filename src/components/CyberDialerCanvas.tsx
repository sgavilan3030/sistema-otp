import React, { useEffect, useRef } from 'react';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseRadius: number;
  pulseSpeed: number;
  pulsePhase: number;
  color: string;
  label?: string;
}

interface Packet {
  sourceIndex: number;
  targetIndex: number;
  progress: number;
  speed: number;
  color: string;
}

interface RainColumn {
  x: number;
  y: number;
  speed: number;
  chars: string[];
  updateInterval: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  color: string;
}

export const CyberDialerCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    let width = window.innerWidth || 1920;
    let height = window.innerHeight || 1080;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const updateDimensions = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth || document.documentElement.clientWidth || 1920;
      height = window.innerHeight || document.documentElement.clientHeight || 1080;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    updateDimensions();

    let mouseX = width * 0.5;
    let mouseY = height * 0.5;
    let hasMouseInteracted = false;

    const handleMouseMove = (e: MouseEvent) => {
      hasMouseInteracted = true;
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    window.addEventListener('mousemove', handleMouseMove);

    const handleResize = () => {
      updateDimensions();
      initNetwork();
    };

    window.addEventListener('resize', handleResize);

    const matrixChars = '0123456789ABCDEF#*+<>@%&/!=SIPVOIPRTPHD20';
    const telecomTelemetry = [
      'BLACK HAT DIALER SYSTEM CORE',
      'PJSIP/1001 REGISTERED',
      'TELEVOX 52.144.46.192 UP',
      'SIP/2.0 200 OK',
      'INVITE sip:target@carrier',
      'JITTERBUFFER=max_350,target_60',
      'DENOISE(rx/tx)=ON',
      'OPUS 48kHz FULLBAND HD',
      'G.722 WIDEBAND 16kHz',
      'ASTDB PUT ivr_vars',
      'AMI FAST ORIGINATE OK',
      'ARI STASIS BRIDGE ENCRYPTED',
      'CDR LOGGED BILLSEC=48',
      'LATENCY 14ms JITTER 0.1ms',
      'PRESS-1 READY -> RET_AGENT',
      'LIVE OTP: 7777 / 6666 / 5555',
      'AUDIO: STEREO DUAL-LEG HD',
    ];

    const nodeLabels = [
      'PJSIP / 1001',
      'PJSIP / 1002',
      'TELEVOX TRUNK',
      'TWILIO GATEWAY',
      'AMI : 5038',
      'ARI : 8088',
      'ASTDB.SQLITE3',
      'IVR-PRESS1',
      'OTP-7777',
      'OTP-6666',
      'DSP-OPUS-48K',
      'DENOISE-RX/TX',
      'RTP-STREAM-HD',
      'CORE-KERNEL-20',
      'JITTER-BUFFER-350',
    ];

    let nodes: Node[] = [];
    let packets: Packet[] = [];
    let rainColumns: RainColumn[] = [];
    let particles: Particle[] = [];

    const initNetwork = () => {
      nodes = [];
      const nodeCount = Math.max(28, Math.min(Math.floor((width * height) / 25000), 50));
      const colors = ['#10b981', '#06b6d4', '#34d399', '#38bdf8', '#6ee7b7'];

      for (let i = 0; i < nodeCount; i++) {
        const radius = Math.random() * 3 + 2.5;
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.7,
          vy: (Math.random() - 0.5) * 0.7,
          radius,
          baseRadius: radius,
          pulseSpeed: Math.random() * 0.05 + 0.03,
          pulsePhase: Math.random() * Math.PI * 2,
          color: colors[i % colors.length],
          label: i < nodeLabels.length ? nodeLabels[i] : undefined,
        });
      }

      packets = [];
      for (let i = 0; i < 20; i++) {
        spawnPacket();
      }

      rainColumns = [];
      const colSpacing = 38;
      const colCount = Math.floor(width / colSpacing);
      for (let i = 0; i < colCount; i++) {
        const charLength = Math.floor(Math.random() * 12) + 8;
        const chars: string[] = [];
        for (let j = 0; j < charLength; j++) {
          chars.push(matrixChars[Math.floor(Math.random() * matrixChars.length)]);
        }
        rainColumns.push({
          x: i * colSpacing + Math.random() * 10,
          y: Math.random() * height,
          speed: Math.random() * 2.6 + 1.2,
          chars,
          updateInterval: Math.floor(Math.random() * 5) + 3,
        });
      }

      particles = [];
      for (let i = 0; i < 40; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.5,
          vy: -Math.random() * 0.9 - 0.2,
          size: Math.random() * 2.5 + 1.2,
          alpha: Math.random() * 0.7 + 0.3,
          color: Math.random() > 0.4 ? '#10b981' : '#06b6d4',
        });
      }
    };

    const spawnPacket = () => {
      if (nodes.length < 2) return;
      const source = Math.floor(Math.random() * nodes.length);
      let target = Math.floor(Math.random() * nodes.length);
      while (target === source) {
        target = Math.floor(Math.random() * nodes.length);
      }
      packets.push({
        sourceIndex: source,
        targetIndex: target,
        progress: 0,
        speed: Math.random() * 0.013 + 0.007,
        color: Math.random() > 0.4 ? '#34d399' : '#38bdf8',
      });
    };

    initNetwork();

    let frame = 0;
    let time = 0;

    const render = () => {
      try {
        frame++;
        time += 0.025;

        ctx.save();
        ctx.scale(dpr, dpr);

        // 1. VIBRANT HIGH-CONTRAST OBSIDIAN CYBER BACKGROUND
        const bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, '#010906');
        bgGrad.addColorStop(0.35, '#031710');
        bgGrad.addColorStop(0.7, '#02120d');
        bgGrad.addColorStop(1, '#000402');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        // Glowing Ambient Nebulas
        const orb1 = ctx.createRadialGradient(
          width * 0.8,
          height * 0.25,
          20,
          width * 0.8,
          height * 0.25,
          width * 0.45
        );
        orb1.addColorStop(0, 'rgba(6, 182, 212, 0.32)');
        orb1.addColorStop(0.5, 'rgba(16, 185, 129, 0.18)');
        orb1.addColorStop(1, 'transparent');
        ctx.fillStyle = orb1;
        ctx.fillRect(0, 0, width, height);

        const orb2 = ctx.createRadialGradient(
          width * 0.15,
          height * 0.85,
          30,
          width * 0.15,
          height * 0.85,
          width * 0.42
        );
        orb2.addColorStop(0, 'rgba(16, 185, 129, 0.32)');
        orb2.addColorStop(0.6, 'rgba(5, 150, 105, 0.12)');
        orb2.addColorStop(1, 'transparent');
        ctx.fillStyle = orb2;
        ctx.fillRect(0, 0, width, height);

        // 2. HIGH-TECH GLOWING CYBER GRID WITH CROSSES
        ctx.lineWidth = 1;
        const gridSize = 55;
        const gridAlpha = 0.22 + Math.sin(time * 1.5) * 0.05;
        ctx.strokeStyle = `rgba(16, 185, 129, ${gridAlpha})`;

        ctx.beginPath();
        for (let x = 0; x < width; x += gridSize) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
        }
        for (let y = 0; y < height; y += gridSize) {
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
        }
        ctx.stroke();

        ctx.fillStyle = 'rgba(52, 211, 153, 0.6)';
        for (let x = gridSize; x < width; x += gridSize * 2) {
          for (let y = gridSize; y < height; y += gridSize * 2) {
            ctx.fillRect(x - 3, y - 0.5, 7, 1);
            ctx.fillRect(x - 0.5, y - 3, 1, 7);
          }
        }

        // 3. VIBRANT MATRIX DIGITAL RAIN COLUMNS (Ultra-Visible)
        ctx.font = 'bold 12px "JetBrains Mono", Consolas, monospace';
        rainColumns.forEach((col) => {
          col.y += col.speed;
          if (col.y > height + 220) {
            col.y = -Math.random() * 150 - 50;
            col.speed = Math.random() * 2.6 + 1.2;
          }

          if (frame % col.updateInterval === 0) {
            const randIdx = Math.floor(Math.random() * col.chars.length);
            col.chars[randIdx] = matrixChars[Math.floor(Math.random() * matrixChars.length)];
          }

          for (let i = 0; i < col.chars.length; i++) {
            const charY = col.y - i * 16;
            if (charY < -20 || charY > height + 20) continue;

            if (i === 0) {
              ctx.fillStyle = '#ffffff';
              ctx.shadowColor = '#34d399';
              ctx.shadowBlur = 14;
              ctx.fillText(col.chars[i], col.x, charY);
              ctx.shadowBlur = 0;
            } else if (i === 1) {
              ctx.fillStyle = '#6ee7b7';
              ctx.shadowColor = '#10b981';
              ctx.shadowBlur = 10;
              ctx.fillText(col.chars[i], col.x, charY);
              ctx.shadowBlur = 0;
            } else {
              const alpha = Math.max(0.18, (1 - i / col.chars.length) * 0.85);
              ctx.fillStyle = `rgba(16, 185, 129, ${alpha})`;
              ctx.fillText(col.chars[i], col.x, charY);
            }
          }
        });

        // 4. FLOATING TELEMETRY BANNERS
        const bannerY1 = (time * 30) % (height + 200) - 80;
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(6, 182, 212, 0.7)';
        ctx.fillText(
          `>> PJSIP ENGINE RUNNING: ${telecomTelemetry[Math.floor(time * 0.5) % telecomTelemetry.length]}`,
          width * 0.04,
          bannerY1
        );

        const bannerY2 = height - ((time * 35) % (height + 200) - 80);
        ctx.fillStyle = 'rgba(52, 211, 153, 0.7)';
        ctx.fillText(
          `>> MATRIX TELEPHONY LINK: ${telecomTelemetry[Math.floor(time * 0.7 + 3) % telecomTelemetry.length]}`,
          width * 0.52,
          bannerY2
        );

        // 5. LARGE HOLOGRAPHIC BLACK HAT EMBLEM & TARGETING SYSTEM (CENTER/RIGHT)
        const emblemCenterX = width > 800 ? width * 0.72 : width * 0.5;
        const emblemCenterY = height * 0.48;
        const emblemRadius = Math.min(width, height) * 0.28;

        ctx.save();
        ctx.beginPath();
        ctx.arc(emblemCenterX, emblemCenterY, emblemRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(emblemCenterX, emblemCenterY, emblemRadius * 0.75, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.40)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(emblemCenterX, emblemCenterY, emblemRadius * 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.55)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Rotating Sonar Scan Beam
        const sweepAngle = time * 1.3;
        const sweepGrad = ctx.createRadialGradient(
          emblemCenterX,
          emblemCenterY,
          0,
          emblemCenterX,
          emblemCenterY,
          emblemRadius
        );
        sweepGrad.addColorStop(0, 'rgba(52, 211, 153, 0.45)');
        sweepGrad.addColorStop(0.7, 'rgba(16, 185, 129, 0.20)');
        sweepGrad.addColorStop(1, 'transparent');

        ctx.beginPath();
        ctx.moveTo(emblemCenterX, emblemCenterY);
        ctx.arc(emblemCenterX, emblemCenterY, emblemRadius, sweepAngle - 0.6, sweepAngle);
        ctx.closePath();
        ctx.fillStyle = sweepGrad;
        ctx.fill();

        // Vector Holographic Hat Silhouette in Center
        const hatScale = Math.min(width, height) * 0.0014;
        ctx.save();
        ctx.translate(emblemCenterX, emblemCenterY - 15);
        ctx.scale(hatScale, hatScale);

        // Hat Brim
        ctx.beginPath();
        ctx.ellipse(0, 30, 85, 20, 0, 0, Math.PI * 2);
        ctx.strokeStyle = '#34d399';
        ctx.shadowColor = '#10b981';
        ctx.shadowBlur = 20;
        ctx.lineWidth = 4;
        ctx.stroke();

        // Hat Crown
        ctx.beginPath();
        ctx.moveTo(-45, 25);
        ctx.lineTo(-40, -50);
        ctx.bezierCurveTo(-40, -68, 40, -68, 40, -50);
        ctx.lineTo(45, 25);
        ctx.closePath();
        ctx.strokeStyle = '#6ee7b7';
        ctx.lineWidth = 3.5;
        ctx.stroke();

        // Hat Band
        ctx.beginPath();
        ctx.moveTo(-44, 10);
        ctx.bezierCurveTo(-30, 18, 30, 18, 44, 10);
        ctx.lineTo(44.5, 22);
        ctx.bezierCurveTo(30, 30, -30, 30, -44.5, 22);
        ctx.closePath();
        ctx.fillStyle = 'rgba(6, 182, 212, 0.55)';
        ctx.fill();
        ctx.strokeStyle = '#38bdf8';
        ctx.stroke();

        ctx.restore();
        ctx.shadowBlur = 0;

        // Text inside the target
        ctx.font = 'bold 12px "JetBrains Mono", monospace';
        ctx.fillStyle = '#34d399';
        ctx.textAlign = 'center';
        ctx.fillText('BLACK HAT DIALER SYSTEM CORE', emblemCenterX, emblemCenterY + emblemRadius * 0.55);
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText('VOIP TELEPHONY MATRIX • AUTONOMOUS ENGINE', emblemCenterX, emblemCenterY + emblemRadius * 0.55 + 16);
        ctx.textAlign = 'left';

        ctx.restore();

        // 6. CONNECTED NODES AND PACKETS (Luminous Telephony Graph)
        nodes.forEach((node) => {
          node.x += node.vx;
          node.y += node.vy;

          if (node.x < 15) { node.x = 15; node.vx *= -1; }
          if (node.x > width - 15) { node.x = width - 15; node.vx *= -1; }
          if (node.y < 15) { node.y = 15; node.vy *= -1; }
          if (node.y > height - 15) { node.y = height - 15; node.vy *= -1; }

          if (hasMouseInteracted) {
            const dx = mouseX - node.x;
            const dy = mouseY - node.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 180) {
              const force = (180 - dist) / 180;
              node.x -= (dx / dist) * force * 2.5;
              node.y -= (dy / dist) * force * 2.5;
            }
          }

          node.pulsePhase += node.pulseSpeed;
          const currentRad = node.baseRadius + Math.sin(node.pulsePhase) * 1.2;

          const glow = ctx.createRadialGradient(
            node.x,
            node.y,
            0,
            node.x,
            node.y,
            currentRad * 5
          );
          glow.addColorStop(0, node.color);
          glow.addColorStop(0.5, 'rgba(16, 185, 129, 0.45)');
          glow.addColorStop(1, 'transparent');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(node.x, node.y, currentRad * 5, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(node.x, node.y, currentRad * 0.8, 0, Math.PI * 2);
          ctx.fill();

          // Safe pill rendering (replaces roundRect to avoid any TypeError)
          if (node.label) {
            ctx.font = 'bold 9px "JetBrains Mono", monospace';
            const textWidth = ctx.measureText(node.label).width;

            ctx.fillStyle = 'rgba(2, 20, 15, 0.9)';
            ctx.strokeStyle = 'rgba(52, 211, 153, 0.7)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.rect(node.x + 8, node.y - 8, textWidth + 10, 16);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#a7f3d0';
            ctx.fillText(node.label, node.x + 13, node.y + 4);
          }
        });

        // Connections between nodes
        const maxDist = 160;
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const n1 = nodes[i];
            const n2 = nodes[j];
            const dx = n1.x - n2.x;
            const dy = n1.y - n2.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < maxDist) {
              const alpha = (1 - dist / maxDist) * 0.65;
              ctx.strokeStyle = `rgba(52, 211, 153, ${alpha})`;
              ctx.lineWidth = 1.3;
              ctx.beginPath();
              ctx.moveTo(n1.x, n1.y);
              ctx.lineTo(n2.x, n2.y);
              ctx.stroke();
            }
          }
        }

        // 7. FAST HIGH-SPEED TELEPHONY PACKETS
        packets.forEach((p, idx) => {
          p.progress += p.speed;
          if (p.progress >= 1) {
            packets[idx] = {
              sourceIndex: Math.floor(Math.random() * nodes.length),
              targetIndex: Math.floor(Math.random() * nodes.length),
              progress: 0,
              speed: Math.random() * 0.015 + 0.008,
              color: Math.random() > 0.4 ? '#34d399' : '#38bdf8',
            };
            return;
          }

          const src = nodes[p.sourceIndex];
          const tgt = nodes[p.targetIndex];
          if (!src || !tgt) return;

          const currX = src.x + (tgt.x - src.x) * p.progress;
          const currY = src.y + (tgt.y - src.y) * p.progress;

          const tailX = src.x + (tgt.x - src.x) * Math.max(0, p.progress - 0.08);
          const tailY = src.y + (tgt.y - src.y) * Math.max(0, p.progress - 0.08);

          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2.8;
          ctx.beginPath();
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(currX, currY);
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(currX, currY, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        });

        // 8. RISING CYBER SPARK PARTICLES
        particles.forEach((p) => {
          p.x += p.vx;
          p.y += p.vy;
          if (p.y < -10) {
            p.y = height + 10;
            p.x = Math.random() * width;
          }
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.alpha;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        });

        // 9. DYNAMIC AUDIO EQUALIZER FREQUENCY BARS (FOOTER)
        const eqBarCount = Math.min(Math.floor(width / 18), 54);
        const eqStartX = width * 0.02;
        const eqBaseY = height - 16;
        const barW = Math.max(4, Math.floor((width * 0.42) / eqBarCount) - 3);

        ctx.save();
        for (let b = 0; b < eqBarCount; b++) {
          const val =
            Math.sin(time * 4 + b * 0.35) * 0.45 +
            Math.cos(time * 6 - b * 0.5) * 0.35 +
            Math.sin(time * 8 + b * 0.8) * 0.2;
          const barH = Math.max(6, Math.abs(val) * 48 + 6);

          const bx = eqStartX + b * (barW + 3);
          const by = eqBaseY - barH;

          const bGrad = ctx.createLinearGradient(bx, eqBaseY, bx, by);
          bGrad.addColorStop(0, '#10b981');
          bGrad.addColorStop(0.6, '#06b6d4');
          bGrad.addColorStop(1, '#a7f3d0');

          ctx.fillStyle = bGrad;
          ctx.fillRect(bx, by, barW, barH);
        }

        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.fillStyle = '#34d399';
        ctx.fillText(
          '● DSP LIVE SPECTRUM: OPUS 48kHz HD AUDIO STREAM • DENOISE RX/TX ACTIVE • 0.0% LOSS',
          eqStartX,
          eqBaseY - 58
        );
        ctx.restore();

        ctx.restore();
      } catch (err) {
        console.warn('CyberDialerCanvas frame render error:', err);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full block pointer-events-auto cyber-login-canvas"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 0,
        display: 'block',
      }}
    />
  );
};
