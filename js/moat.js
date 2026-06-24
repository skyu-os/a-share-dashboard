/**
 * A股财务数据全景仪表盘 - 护城河笔记系统
 * 管理定性标签：门槛等级、不可替代性、证据链、Obsidian 链接
 */
const MoatModule = {
    notes: {},
    loaded: false,

    // Obsidian vault 路径
    OBSIDIAN_VAULT: 'Obsidian',
    OBSIDIAN_WIKI_PATH: 'E:/Obsidian/ALL/wiki/',

    init() {
        this.loadNotes();
    },

    loadNotes() {
        // 尝试从 localStorage 或 moat_notes.json 加载
        try {
            const stored = localStorage.getItem('moat_notes');
            if (stored) {
                this.notes = JSON.parse(stored);
                this.loaded = true;
            }
        } catch (e) {
            console.warn('护城河笔记加载失败', e);
        }
        // Initial seed: load from embedded JSON if available
        if (typeof MOAT_INITIAL_DATA !== 'undefined') {
            Object.assign(this.notes, MOAT_INITIAL_DATA);
        }
    },

    saveNotes() {
        try {
            localStorage.setItem('moat_notes', JSON.stringify(this.notes));
        } catch (e) {
            console.warn('护城河笔记保存失败', e);
        }
    },

    getMoat(stkcd) {
        return this.notes[stkcd] || null;
    },

    setMoat(stkcd, data) {
        this.notes[stkcd] = { ...data, last_updated: new Date().toISOString().slice(0, 10) };
        this.saveNotes();
    },

    hasNotes(stkcd) {
        return !!this.notes[stkcd];
    },

    refreshCoverage() {
        // Update coverage display in left panel
        const container = document.getElementById('rd-moat-coverage');
        if (!container) return;
        let covered = 0, total = 0;
        for (const [stkcd, data] of Object.entries(RD_SCORES)) {
            if (!data.rd_applicable || data.group !== RDModule.activeGroup && RDModule.activeGroup !== 'all') continue;
            total++;
            if (this.hasNotes(stkcd)) covered++;
        }
        const pct = total > 0 ? Math.round(covered / total * 100) : 0;
        container.innerHTML = `
            <div style="font-weight:600;margin-bottom:4px;">研究覆盖度</div>
            <div class="moat-bar">
                <span>${covered}/${total}</span>
                <div class="moat-fill" style="width:${pct}%;"></div>
                <span>${pct}%</span>
            </div>
        `;
    },

    renderMoat(stkcd) {
        const container = document.getElementById('rd-moat-section');
        if (!container) return;
        const moat = this.getMoat(stkcd);
        const data = RD_SCORES[stkcd];
        if (!data) { container.innerHTML = ''; return; }

        // Auto-detect Obsidian links
        let obsidianLinks = [];
        if (moat?.obsidian_links) {
            obsidianLinks = moat.obsidian_links;
        }

        let html = '<h4>🛡️ 技术护城河</h4>';
        if (moat) {
            const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
            html += `<div class="rd-moat-row"><span class="moat-label">门槛等级</span><span class="moat-stars">${stars(moat.barrier_level || 0)}</span></div>`;
            html += `<div class="rd-moat-row"><span class="moat-label">不可替代性</span><span class="moat-stars">${stars(moat.irreplaceability || 0)}</span></div>`;
            if (moat.chain_position) {
                html += `<div class="rd-moat-row"><span class="moat-label">产业链位置</span><span>${Utils.escapeHtml(moat.chain_position)}</span></div>`;
            }
            const evidenceLabels = { customer_validation: '客户验证', order_visibility: '订单可见', patent_search: '专利检索', competitive_landscape: '竞争格局', technology_roadmap: '技术路线图' };
            const evidenceHtml = Object.entries(evidenceLabels).map(([k, v]) =>
                `<span style="color:${moat.evidence?.[k] ? '#16a34a' : '#d1d5db'}">${moat.evidence?.[k] ? '☑' : '☐'}${v}</span>`
            ).join(' ');
            html += `<div class="rd-moat-row"><span class="moat-label">证据强度</span><span class="moat-evidence">${evidenceHtml}</span></div>`;
            if (moat.notes) {
                html += `<div class="rd-moat-notes">${Utils.escapeHtml(moat.notes)}</div>`;
            }
        } else {
            html += '<div style="color:var(--text-secondary);font-size:12px;padding:8px 0;">暂无护城河评级<br><small>点击下方按钮开始标注</small></div>';
        }

        // Obsidian links
        if (obsidianLinks.length > 0) {
            html += '<div style="margin-top:8px;">';
            obsidianLinks.forEach(link => {
                const encodedPath = encodeURIComponent(link.replace(/\.md$/, ''));
                html += `<a class="rd-moat-link" href="obsidian://open?vault=${this.OBSIDIAN_VAULT}&file=${encodedPath}" target="_blank">📝 ${Utils.escapeHtml(link)}</a><br>`;
            });
            html += '</div>';
        } else {
            html += '<div style="margin-top:8px;font-size:11px;color:var(--text-secondary);">未关联 Obsidian 笔记</div>';
        }

        // Edit button
        html += `<button class="btn" style="margin-top:8px;font-size:11px;" onclick="MoatModule.openEditor('${stkcd}')">✏️ 编辑护城河评级</button>`;
        container.innerHTML = html;
    },

    openEditor(stkcd) {
        // Open a modal/drawer for editing (simplified: prompt-based)
        // Full implementation should use a proper modal component
        const existing = this.getMoat(stkcd);
        const barrier = prompt('门槛等级 (1-5):', existing?.barrier_level || '');
        if (barrier === null) return;
        const irreplace = prompt('不可替代性 (1-5):', existing?.irreplaceability || '');
        if (irreplace === null) return;
        const notes = prompt('研究笔记:', existing?.notes || '');
        if (notes === null) return;

        this.setMoat(stkcd, {
            barrier_level: parseInt(barrier) || 0,
            irreplaceability: parseInt(irreplace) || 0,
            evidence: existing?.evidence || {},
            chain_position: existing?.chain_position || '',
            obsidian_links: existing?.obsidian_links || [],
            notes: notes
        });
        this.renderMoat(stkcd);
        this.refreshCoverage();
    }
};

// Auto-init on load
document.addEventListener('DOMContentLoaded', () => MoatModule.init());
