const cardFor = (target) => target?.closest?.('[data-il-uid]') ?? null;

export class ReorderController {
    constructor({ root, liveRegion, getItems, move, announce }) {
        this.root = root;
        this.liveRegion = liveRegion;
        this.getItems = getItems;
        this.move = move;
        this.announce = announce;
        this.draggedUid = null;
        this.pointer = null;

        this.handleDragStart = this.handleDragStart.bind(this);
        this.handleDragOver = this.handleDragOver.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
        this.handleDragEnd = this.handleDragEnd.bind(this);
        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handlePointerCancel = this.handlePointerCancel.bind(this);
        this.handleLostPointerCapture = this.handleLostPointerCapture.bind(this);

        root.addEventListener('dragstart', this.handleDragStart);
        root.addEventListener('dragover', this.handleDragOver);
        root.addEventListener('drop', this.handleDrop);
        root.addEventListener('dragend', this.handleDragEnd);
        root.addEventListener('pointerdown', this.handlePointerDown);
        root.addEventListener('pointermove', this.handlePointerMove);
        root.addEventListener('pointerup', this.handlePointerUp);
        root.addEventListener('pointercancel', this.handlePointerCancel);
        root.addEventListener('lostpointercapture', this.handleLostPointerCapture);
    }

    item(uid) {
        return this.getItems().find((candidate) => candidate.uid === uid) ?? null;
    }

    moveTo(uid, position) {
        const item = this.item(uid);
        if (!item) {
            return false;
        }

        const destination = Math.max(0, Math.min(position, this.getItems().length - 1));
        if (destination === item.position) {
            return false;
        }

        this.move({ uid, position: destination });
        this.liveRegion.textContent = this.announce(destination + 1);
        return true;
    }

    moveByButton(uid, direction) {
        const item = this.item(uid);
        if (!item) {
            return false;
        }

        return this.moveTo(uid, item.position + direction);
    }

    handleDragStart(event) {
        const handle = event.target?.closest?.('[data-il-reorder-handle]');
        const card = handle ? cardFor(handle) : null;
        if (!card) {
            return;
        }

        this.draggedUid = card.dataset.ilUid;
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData?.('text/plain', this.draggedUid);
            const preview = handle.closest('.il-card')?.querySelector('.il-preview');
            if (preview && typeof event.dataTransfer.setDragImage === 'function') {
                const box = preview.getBoundingClientRect();
                const offset = (coordinate, start, size) => Math.round(Math.max(0, Math.min(size,
                    Number.isFinite(coordinate) ? coordinate - start : size / 2)));
                try {
                    event.dataTransfer.setDragImage(preview,
                        offset(event.clientX, box.left, box.width), offset(event.clientY, box.top, box.height));
                } catch {
                    // Native default feedback still permits the same reorder operation.
                }
            }
        }
    }

    handleDragOver(event) {
        if (!this.draggedUid || !cardFor(event.target)) {
            return;
        }

        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
    }

    handleDrop(event) {
        const target = cardFor(event.target);
        if (!this.draggedUid || !target) {
            return;
        }

        event.preventDefault();
        const destination = this.item(target.dataset.ilUid);
        if (destination) {
            this.moveTo(this.draggedUid, destination.position);
        }
        this.draggedUid = null;
    }

    handleDragEnd() {
        this.draggedUid = null;
    }

    handlePointerDown(event) {
        const handle = event.target?.closest?.('[data-il-reorder-handle]');
        const card = handle ? cardFor(handle) : null;
        if (!card) {
            return;
        }

        this.pointer = {
            id: event.pointerId,
            uid: card.dataset.ilUid,
            handle,
            destinationUid: null,
            captured: false,
        };
        try {
            handle.setPointerCapture?.(event.pointerId);
            this.pointer.captured = true;
        } catch {
            this.pointer.captured = false;
        }
        this.updatePointerDestination(event);
    }

    updatePointerDestination(event) {
        if (!this.pointer || this.pointer.id !== event.pointerId) {
            return;
        }
        const target = this.root.ownerDocument.elementFromPoint?.(event.clientX, event.clientY) ?? event.target;
        const card = cardFor(target);
        this.pointer.destinationUid = card && this.root.contains(card) ? card.dataset.ilUid : null;
    }

    handlePointerMove(event) {
        this.updatePointerDestination(event);
    }

    handlePointerUp(event) {
        if (!this.pointer || this.pointer.id !== event.pointerId) {
            return;
        }

        this.updatePointerDestination(event);
        this.finishPointer(true);
    }

    finishPointer(commit) {
        const pointer = this.pointer;
        if (!pointer) {
            return;
        }
        this.pointer = null;
        if (pointer.captured) {
            try {
                pointer.handle.releasePointerCapture?.(pointer.id);
            } catch {
                // A cancelled capture may already have been released by the browser.
            }
        }
        const destination = commit && pointer.destinationUid ? this.item(pointer.destinationUid) : null;
        if (destination) {
            this.moveTo(pointer.uid, destination.position);
        }
    }

    handlePointerCancel(event) {
        if (this.pointer?.id === event.pointerId) {
            this.finishPointer(false);
        }
    }

    handleLostPointerCapture(event) {
        if (this.pointer?.id === event.pointerId) {
            this.pointer = null;
        }
    }

    destroy() {
        this.root.removeEventListener('dragstart', this.handleDragStart);
        this.root.removeEventListener('dragover', this.handleDragOver);
        this.root.removeEventListener('drop', this.handleDrop);
        this.root.removeEventListener('dragend', this.handleDragEnd);
        this.root.removeEventListener('pointerdown', this.handlePointerDown);
        this.root.removeEventListener('pointermove', this.handlePointerMove);
        this.root.removeEventListener('pointerup', this.handlePointerUp);
        this.root.removeEventListener('pointercancel', this.handlePointerCancel);
        this.root.removeEventListener('lostpointercapture', this.handleLostPointerCapture);
        this.draggedUid = null;
        this.finishPointer(false);
    }
}
