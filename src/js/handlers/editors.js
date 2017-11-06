var EditorsHandler = function () {

    this.Notifications = undefined;
    this.IdeSettings   = undefined;
    this.Modelist      = ace.require("ace/ext/modelist");
    this.StatusBar     = ace.require('ace/ext/statusbar').StatusBar;

    this.idx                  = 0;
    this.currentIdx           = null;
    this.previousIdx          = null;
    this.aceEditors           = [];
    this.aceCleanHashes       = [];
    this.aceClipboard         = '';
    this.navCloseBtnHtml      = '<i class="fa fa-fw fa-close text-white action-close-tab"></i>';
    this.navDirtyBtnHtml      = '<i class="fa fa-fw fa-circle dirty-tab modal-confirm-close-tab" data-toggle="modal" data-target=".modal-md-container" data-title="Save changes"></i>';
    this.navTabIconHtml       = '<i class="filetype-icon icon"></i>';
    this.navFilenameHtml      = '<span class="action-edit-tab filename"></span>';
    this.newFileDropdownEntry = '<a class="dropdown-item action-add-tab" href="#"></a>';

    this.defaultTheme      = null;
    this.defaultFont       = null;
    this.defaultFileName   = null;
    this.defaultFileExt    = null;
    this.undefinedFileMode = null;
    this.undefinedFileIcon = null;


    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// Private Helper
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    this._getHash = function (input) {
        var hash = 0, len = input.length;
        for (var i = 0; i < len; i++) {
            hash = ((hash << 5) - hash) + input.charCodeAt(i);
            hash |= 0;
        }
        return hash;
    };

    this._loadDefaults = function () {

        var that     = this;
        var deferred = $.Deferred();

        $.get('/src/settings/ace.defaults.json', function (data) {
            data = JSON.parse(data);

            that.defaultTheme      = data.theme;
            that.defaultFont       = data.fontFamily;
            that.defaultFileName   = data.newFileName;
            that.defaultFileExt    = data.newFileExt;
            that.undefinedFileMode = data.undefinedFile.mode;
            that.undefinedFileIcon = data.undefinedFile.icon;

            deferred.resolve();
        });

        return deferred.promise();
    };

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// Private File
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    this._fileExtFromFileEntry = function (fileEntry) {
        return fileEntry.name.split('.').pop();
    };

    this._fileNameFromFileEntry = function (fileEntry) {
        return fileEntry.name.split('.').reverse().pop();
    };

    this._fileOpen = function (fileEntry, nodeId) {

        var that = this;

        fileEntry.file(function (file) {
            var reader   = new FileReader();
            var fileExt  = that._fileExtFromFileEntry(fileEntry);
            var fileName = that._fileNameFromFileEntry(fileEntry);

            reader.readAsText(file);
            reader.onerror = function (msg) {
                that.Notifications.notify('danger', 'File Error', msg);
            };
            reader.onload  = function (e) {
                that.onAddNewTab(fileExt, fileName, e.target.result, fileEntry, nodeId);
            };
        }, function (err) {
            that.Notifications.notify('danger', 'File Error', err);
        });
    };

    this._fileRename = function (fileEntry, newFileName) {

        var that     = this;
        var deferred = $.Deferred();

        if (typeof newFileName === typeof undefined) {
            deferred.resolve(fileEntry);
            return deferred.promise();
        }

        chrome.fileSystem.getWritableEntry(fileEntry, function (fileEntry) {

            if (chrome.runtime.lastError) {
                that.Notifications.notify('danger', '', chrome.runtime.lastError.message);
                deferred.resolve();
                return false;
            }

            fileEntry.getParent(function (parent) {
                fileEntry.moveTo(parent, newFileName, function (newFileEntry) {
                    deferred.resolve(newFileEntry);
                }, function (err) {
                    that.Notifications.notify('danger', 'File Error', err);
                })
            }, function (err) {
                that.Notifications.notify('danger', 'File Error', err);
            });
        });
        return deferred.promise();
    };

    this._fileSave = function (fileEntry, fileContent) {

        var that     = this;
        var deferred = $.Deferred();

        chrome.fileSystem.getWritableEntry(fileEntry, function (writableEntry) {

            if (chrome.runtime.lastError) {
                that.Notifications.notify('danger', '', chrome.runtime.lastError.message);
                deferred.resolve();
                return false;
            }

            writableEntry.createWriter(function (writer) {
                writer.onerror    = function (err) {
                    that.Notifications.notify('danger', 'File Error', err);
                };
                writer.onwriteend = function (e) {
                    deferred.resolve(e);
                };
                writer.seek(0);
                writer.write(new Blob([fileContent], {type: 'text/plain'}));
            });
        });

        return deferred.promise();
    };

    this._fileSaveAs = function (fileName, fileContent) {

        var that     = this;
        var deferred = $.Deferred();

        chrome.fileSystem.chooseEntry({type: 'saveFile', suggestedName: fileName, acceptsMultiple: false}, function (writableEntry) {

            if (chrome.runtime.lastError) {
                that.Notifications.notify('danger', '', chrome.runtime.lastError.message);
                deferred.resolve();
                return false;
            }

            writableEntry.createWriter(function (writer) {
                writer.onerror    = function (err) {
                    that.Notifications.notify('danger', 'File Error', err);
                };
                writer.onwriteend = function (e) {
                    deferred.resolve(e);
                };
                writer.write(new Blob([fileContent], {type: 'text/plain'}));
            });
        });

        return deferred.promise();
    };

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// Private Ace
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    this._bootAceEditor = function (idx, fileContent, fileEntry) {

        if (typeof idx === typeof undefined) {
            return false;
        }

        idx           = parseInt(idx);
        var that      = this;
        var aceEditor = ace.edit('codepad-editor-' + idx);

        // Configure Ace
        aceEditor.$blockScrolling = Infinity;
        aceEditor.setTheme(this.defaultTheme);
        aceEditor.setOptions({
            fontFamily: this.defaultFont,
            enableSnippets: true,
            enableLiveAutocompletion: true,
            enableBasicAutocompletion: true
        });

        // Push the editor into our records
        this.aceEditors.push({
            "idx": idx,
            "ace": aceEditor,
            "statusBar": new this.StatusBar(aceEditor, document.getElementById('status-bar-' + idx)),
            "fileEntry": typeof fileEntry === typeof undefined || fileEntry === null ? undefined : fileEntry
        });

        // Configure
        this.setEditorContent(idx, fileContent).then(function () {

            that._setAceEditorMode(idx, fileEntry);
            that._populateNavTabIcon(idx);
            that._populateStatusBar(idx);
            that._bindAceCustomCommands(idx, aceEditor);
            that._bindAceCustomEvents(idx, aceEditor);
        });
    };

    this._bindAceCustomCommands = function (idx, aceEditor) {

        var that = this;

        aceEditor.commands.addCommand({
            name: '__save',
            bindKey: {win: 'ctrl-s', mac: 'ctrl-s'},
            exec: function () {
                that.onSaveFile(idx);
            }
        });

        aceEditor.commands.addCommand({
            name: '__open',
            bindKey: {win: 'ctrl-o', mac: 'ctrl-o'},
            exec: function () {
                that.onOpenFile();
            }
        });

        aceEditor.commands.addCommand({
            name: '__new',
            bindKey: {win: 'ctrl-n', mac: 'ctrl-n'},
            exec: function () {
                that.onAddNewTab();
            }
        });

        aceEditor.commands.addCommand({
            name: '__fullscreen',
            bindKey: {win: 'ctrl-alt-f', mac: 'ctrl-alt-f'},
            exec: function () {
                chrome.app.window.current().fullscreen();
                that.Notifications.notify('info', 'Fullscreen mode', 'Press esc to exit fullscreen...');
            }
        });

        aceEditor.commands.addCommand({
            name: '__minimize',
            bindKey: {win: 'ctrl-alt-[', mac: 'ctrl-alt-['},
            exec: function () {
                chrome.app.window.current().minimize();
            }
        });

        aceEditor.commands.addCommand({
            name: '__maximize',
            bindKey: {win: 'ctrl-alt-]', mac: 'ctrl-alt-]'},
            exec: function () {
                chrome.app.window.current().maximize();
            }
        });

        aceEditor.commands.addCommand({
            name: '__fontDecrease',
            bindKey: {win: 'ctrl-,', mac: 'ctrl-,'},
            exec: function () {
                var fontSize = parseInt(aceEditor.getOption('fontSize').replace(/[^0-9]/g, '')) - 1;
                that.IdeSettings.persistAndApply({key: 'fontSize', val: fontSize + 'pt'});
            }
        });

        aceEditor.commands.addCommand({
            name: '__fontIncrease',
            bindKey: {win: 'ctrl-.', mac: 'ctrl-.'},
            exec: function () {
                var fontSize = parseInt(aceEditor.getOption('fontSize').replace(/[^0-9]/g, '')) + 1;
                that.IdeSettings.persistAndApply({key: 'fontSize', val: fontSize + 'pt'});
            }
        });
    };

    this._bindAceCustomEvents = function (idx, aceEditor) {

        var that = this;

        // Detect changes in content
        aceEditor.on('change', function () {
            that._markNavTabDirty(idx);
        });

        // Maintain a centralised clipboard
        aceEditor.on('copy', function (e) {
            that.aceClipboard = e;
        });
        aceEditor.on('cut', function () {
            that.aceClipboard = aceEditor.getSelectedText();
        });
    };

    this._setAceEditorMode = function (idx, fileEntry) {

        idx = parseInt(idx);

        var that = this;

        if (typeof fileEntry !== typeof undefined) {
            chrome.fileSystem.getDisplayPath(fileEntry, function (path) {
                that.getEditor(idx).setOption('mode', that.Modelist.getModeForPath(path).mode);
                that._populateStatusBar(idx);
            });
        }
        else {
            this._getTabMode(idx).then(function (data) {
                that.getEditor(idx).setOption('mode', 'ace/mode/' + JSON.parse(data).mode);
                that._populateStatusBar(idx);
            });
        }
    };


    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// Private tabs
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    this._getNewTabObject = function (fileExt, fileName, nodeId) {

        this.idx++;

        var obj          = {};
        obj.idx          = this.idx;
        obj.contentId    = 'tab-' + this.idx;
        obj.codeEditorId = 'codepad-editor-' + this.idx;
        obj.statusBarId  = 'status-bar-' + this.idx;
        obj.fileName     = fileName + '.' + fileExt;
        obj.nodeId       = nodeId;

        var $nav = $(
            '<li>' +
            '<a href="#' + obj.contentId + '" role="tab" data-idx="' + this.idx + '" data-toggle="tab">' +
            this.navFilenameHtml +
            this.navCloseBtnHtml +
            '</a>' +
            '</li>'
        );

        $nav.find('.filename').attr('data-idx', this.idx);
        $nav.find('.action-close-tab').attr('data-idx', this.idx);
        $nav.find('.modal-confirm-close-tab').attr('data-idx', this.idx);

        if (typeof nodeId !== typeof undefined && nodeId !== null) {
            $nav.find('.filename').attr('node-id', nodeId);
            $nav.find('.action-close-tab').attr('node-id', nodeId);
            $nav.find('.modal-confirm-close-tab').attr('node-id', nodeId);
        }

        $nav.find('.filename').html(obj.fileName);

        obj.nav = $nav;

        var $content = $(
            '<div class="tab-pane fade" data-idx="' + this.idx + '">' +
            '<div class="editor"></div>' +
            '<div class="ace-status-bar text-white bg-dark"></div>' +
            '</div>'
        );

        $content.find('.editor').attr('id', obj.codeEditorId);
        $content.find('.ace-status-bar').attr('id', obj.statusBarId);
        $content.attr('id', obj.contentId);

        obj.content = $content;

        return obj;
    };

    this._giveTabFocus = function (idx) {

        idx              = parseInt(idx);
        this.previousIdx = parseInt(this.currentIdx);

        if (this.getNumTabs() === 0) {
            this.currentIdx = null;
            return false;
        }

        var $el = (typeof this.getTabNavElement(idx) === typeof undefined)
            ? this.getTabsNavContainer().children().first()
            : this.getTabNavElement(idx);

        $el.find('*[data-toggle="tab"]').first().tab('show');
        this.currentIdx = parseInt(idx);

        if (typeof this.getEditor(idx) !== typeof undefined) {
            this.getEditor(idx).focus();
            return true;
        }

        return false;
    };

    this._closeTabModals = function (idx) {
        $(document).find('.modal[data-idx="' + idx + '"]').modal('hide');
    };

    this._getTabFileExtension = function (idx) {

        idx       = parseInt(idx);
        var $el   = this.getTabNavElement(idx);
        var regEx = /(?:\.([^.]+))?$/;

        if (typeof $el !== typeof undefined) {
            var ext = regEx.exec($el.find('.filename').first().html())[1];
            return ext.toLowerCase();
        }

        return this.undefinedFileMode;
    };

    this._getTabMode = function (idx) {

        var that     = this;
        var deferred = $.Deferred();
        idx          = parseInt(idx);

        this.getAllEditorModes().then(function (data) {
            data    = JSON.parse(data);
            var ext = that._getTabFileExtension(idx);
            if (typeof ext === typeof undefined) {
                deferred.resolve(JSON.stringify({
                    "icon": that.undefinedFileIcon,
                    "mode": that.undefinedFileMode,
                    "name": "Text"
                }));
            }
            if (data.hasOwnProperty(ext)) {
                deferred.resolve(JSON.stringify(data[ext]));
            }
        });

        return deferred.promise();
    };

    this._populateAddTabDropDown = function () {

        var that = this;

        this.getAllEditorModes().done(function (data) {
            data = JSON.parse(data);
            that.getAddTabDropDownContainer().html('');
            $.each(data, function (i, v) {
                that.getAddTabDropDownContainer().append(
                    $(that.newFileDropdownEntry)
                        .attr('data-type', i)
                        .append($(that.navTabIconHtml).addClass(v.icon))
                        .append(v.name)
                );
            });
        });
    };

    this._populateNavTabIcon = function (idx) {

        var that = this;

        idx = parseInt(idx);
        this._getTabMode(idx).then(function (data) {
            data    = JSON.parse(data);
            var $el = that.getTabNavElement(idx).find('*[data-toggle="tab"]').first();
            $el.find('.filetype-icon').remove();
            $el.append(that.navTabIconHtml);
            $el.find('.filetype-icon').addClass(data.icon);
        });
    };

    this._populateStatusBar = function (idx) {

        idx = parseInt(idx);

        var editor     = this.getEditor(idx);
        var $statusBar = this.getStatusBarContentElAtIdx(idx);

        var ro        = editor.getOption('readOnly');
        var isRo      = typeof ro === typeof undefined ? false : ro;
        var lockClass = isRo ? 'fa-lock' : 'fa-unlock';

        var mode = editor.getOption('mode').split('/').pop().toLowerCase().replace(/\b[a-z]/g, function (letter) {
            return letter.toUpperCase();
        });

        var lineEndings = editor.getOption('newLineMode').toLowerCase().replace(/\b[a-z]/g, function (letter) {
            return letter.toUpperCase();
        });

        $statusBar.find('.ace_status-info').remove();
        $statusBar.append(
            '<div class="ace_status-info">' +
            '<span><a href="#" class="action-toggle-readonly" title="Toggle readonly" data-toggle="tooltip"><i class="fa ' + lockClass + ' "></i></a></span>' +
            '<span>' + mode + '</span>' +
            '<span>' + lineEndings + '</span>' +
            '</div>'
        );
    };

    this._markNavTabDirty = function (idx) {

        idx = parseInt(idx);

        if (this._isCleanAtIdx(idx)) {
            this._markNavTabClean(idx);
            return;
        }

        var $el = this.getTabNavElement(idx).find('*[data-toggle="tab"]').first();
        $el.addClass('is-dirty').find('.dirty-tab').remove();
        $el.append($(this.navDirtyBtnHtml).attr('data-idx', idx));
    };

    this._markNavTabClean = function (idx) {

        idx = parseInt(idx);

        var found = false;
        var hash  = this._getHash(this.getEditor(idx).getValue());

        $.each(this.aceCleanHashes, function (i, v) {
            if (v.idx === idx) {
                v.hash = hash;
                found  = true;
            }
        });

        if (!found) {
            this.aceCleanHashes.push({
                "idx": idx,
                "hash": hash
            });
        }

        var $el = this.getTabNavElement(idx).find('*[data-toggle="tab"]').first();
        $el.removeClass('is-dirty').find('.dirty-tab').remove();
    };

    this._isCleanAtIdx = function (idx) {

        idx = parseInt(idx);

        var isClean = false;
        var hash    = this._getHash(this.getEditor(idx).getValue());

        $.each(this.aceCleanHashes, function (i, v) {
            if (v.idx === idx && v.hash === hash) {
                isClean = true;
            }
        });

        return isClean;
    };


    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// Public Ace
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    this.init = function (ideSettings, notifications) {

        var that = this;

        this.Notifications = notifications;
        this.IdeSettings   = ideSettings;

        this._populateAddTabDropDown();

        // Handle adding settings to new tabs
        $(window).on('_ace.new', function (e, idx) {
            that.IdeSettings.fetchAll().then(function (settings) {
                if (typeof settings !== typeof undefined) {
                    var editor = that.getEditor(idx);
                    editor.setOptions(settings);
                    editor.$blockScrolling = Infinity;
                }
            });
        });

        // Launch default tab
        this._loadDefaults().then(function () {
            if (that.getNumTabs() === 0) {
                that.onAddNewTab();
            }
        });
    };

    ///////////////////////////////////
    // Editor Template
    ///////////////////////////////////
    this.getEditorTemplate = function (idx) {

        idx = parseInt(idx);

        var ext      = this._getTabFileExtension(idx);
        var deferred = $.Deferred();

        if (typeof ext !== typeof undefined) {
            $.get('/src/html/templates/' + ext + '.tpl', function (data) {
                deferred.resolve(data);
            });
        }

        return deferred.promise();
    };

    this.setEditorTemplate = function (idx) {

        idx = parseInt(idx);

        var that      = this;
        var aceEditor = this.getEditor(idx);
        var deferred  = $.Deferred();

        if (this.getEditorContent(idx) !== '') {
            deferred.resolve();
        }
        else {
            this.getEditorTemplate(idx).then(function (data) {
                aceEditor.setValue(data);
                aceEditor.clearSelection();
                that._markNavTabClean(idx);
                deferred.resolve();
            });
        }

        return deferred.promise();
    };

    ///////////////////////////////////
    // Editor Content
    ///////////////////////////////////
    this.getEditorContent = function (idx) {

        idx = parseInt(idx);

        var value     = '';
        var aceEditor = this.getEditor(idx);

        if (typeof aceEditor !== typeof undefined && typeof value !== typeof undefined && value !== null) {
            value = aceEditor.getValue();
        }

        return value;
    };

    this.setEditorContent = function (idx, content) {

        idx = parseInt(idx);

        var aceEditor = this.getEditor(idx);
        var deferred  = $.Deferred();

        if (typeof content === typeof undefined) {
            this.setEditorTemplate(idx).then(function () {
                deferred.resolve();
            });
        }
        else {
            aceEditor.setValue(content);
            aceEditor.clearSelection();
            this._markNavTabClean(idx);
            deferred.resolve();
        }

        return deferred.promise();
    };

    ///////////////////////////////////
    // Editor File Entry (chrome)
    ///////////////////////////////////
    this.getEditorFileEntry = function (idx) {

        idx = parseInt(idx);

        var aceEditorFull = this.getEditor(idx, true);

        if (typeof aceEditorFull !== typeof undefined) {
            return aceEditorFull.fileEntry;
        }

        return undefined;
    };

    this.setEditorFileEntry = function (idx, fileEntry) {

        idx = parseInt(idx);

        this.aceEditors.forEach(function (aceEditorEntry) {
            if (aceEditorEntry.idx === idx) {
                aceEditorEntry.fileEntry = fileEntry;
                return false;
            }
        });

        return false;
    };

    ///////////////////////////////////
    // Getters for editors
    ///////////////////////////////////
    this.getCurrentEditor = function () {
        return this.getEditor(this.currentIdx);
    };

    this.getEditor = function (idx, returnFullObj) {

        idx          = parseInt(idx);
        var response = undefined;

        this.aceEditors.forEach(function (aceEditorEntry) {
            if (aceEditorEntry.idx === idx) {
                response = (typeof returnFullObj !== typeof undefined && returnFullObj)
                    ? aceEditorEntry
                    : aceEditorEntry.ace;
                return false;
            }
        });

        return response;
    };

    this.getAllEditorObjects = function () {
        return this.aceEditors;
    };

    ///////////////////////////////////
    // Getters for editor modes
    ///////////////////////////////////
    this.getAllEditorModes = function () {

        var deferred = $.Deferred();

        $.get('/src/settings/ace.modes.json').done(function (data) {
            deferred.resolve(data);
        });

        return deferred.promise();
    };


    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// Public tabs
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    this.getTabNavElement = function (idx) {

        if (typeof idx === typeof undefined) {
            return undefined;
        }

        return this.getTabsNavContainer().find('*[data-idx="' + idx + '"]').first().closest('li');
    };

    this.getTabsNavContainer = function () {
        return $(document).find('.tab-list').first();
    };

    this.getTabContentElement = function (idx) {

        if (typeof idx === typeof undefined) {
            return undefined;
        }

        return this.getTabsContentContainer().find('.tab-pane[data-idx="' + idx + '"]').first();
    };

    this.getTabsContentContainer = function () {
        return $(document).find('.tab-content').first();
    };

    this.getTabNavFilename = function (idx) {
        return this.getTabNavElement(idx).find('.filename').first().html();
    };

    this.getStatusBarContentElAtIdx = function (idx) {

        var $tabContent = this.getTabContentElement(idx);
        if (typeof $tabContent === typeof undefined) {
            return undefined;
        }

        return $tabContent.find('.ace-status-bar').first();
    };

    this.getNumTabs = function () {
        return parseInt(this.getTabsNavContainer().children().length);
    };

    this.getAddTabDropDownContainer = function () {
        return $(document).find('.add-tab-dropdown').first();
    };


    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// Public Event Handlers
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    ///////////////////////////////////
    // Tab Related
    ///////////////////////////////////
    this.onAddNewTab = function (fileExtension, fileName, fileContent, fileEntry, nodeId) {

        fileExtension = (typeof fileExtension === typeof undefined || fileName === null)
            ? this.defaultFileExt
            : fileExtension;

        fileName = (typeof fileName === typeof undefined || fileName === null)
            ? this.defaultFileName + '_' + (this.idx + 1)
            : fileName;

        var obj = this._getNewTabObject(fileExtension, fileName, nodeId);
        this.getTabsNavContainer().append(obj.nav);
        this.getTabsContentContainer().append(obj.content);
        this._bootAceEditor(obj.idx, fileContent, fileEntry);
        this._giveTabFocus(obj.idx);

        $(window).trigger('_ace.new', [obj.idx]).trigger('resize');
        return true;
    };

    this.onEditTabName = function (idx) {

        if (typeof idx === typeof undefined) {
            return false;
        }

        idx = parseInt(idx);

        var that        = this;
        var $fileName   = this.getTabNavElement(idx).find('.filename').first();
        var $siblings   = $fileName.siblings().css('visibility', 'hidden');
        var oldFileName = $fileName.html();

        $fileName.attr('contenteditable', 'true').focus().one('focusout', function () {
            var fileEntry = that.getEditorFileEntry(idx);

            that.setEditorTemplate(idx);
            that._setAceEditorMode(idx);

            if (typeof fileEntry !== typeof undefined) {
                that._fileRename(fileEntry, that.getTabNavFilename(idx)).then(function (fileEntry) {
                    that.setEditorFileEntry(idx, fileEntry);
                });
            }

            $siblings.css('visibility', 'visible');
            $fileName.removeAttr('contenteditable').off('keydown');
        });

        $fileName.on('keydown', function (e) {

            var $this = $(this);

            if (e.which === 27) {
                $this.html(oldFileName);
                $this.trigger('focusout');
            }

            if (e.which === 13) {
                $this.trigger('focusout');
            }
        });

        $(window).trigger('resize');
    };

    this.onCloseTab = function (idx) {

        if (typeof idx === typeof undefined) {
            return false;
        }

        idx = parseInt(idx);
        this.getTabNavElement(idx).remove();
        this.getTabContentElement(idx).remove();
        this._giveTabFocus(this.previousIdx);
        this._closeTabModals(idx);

        $(window).trigger('resize');

        return true;
    };

    ///////////////////////////////////
    // File System Related
    ///////////////////////////////////
    this.onOpenFile = function () {

        var that = this;

        chrome.fileSystem.chooseEntry({type: 'openWritableFile'}, function (fileEntry) {

            if (chrome.runtime.lastError) {
                that.Notifications.notify('danger', '', chrome.runtime.lastError.message);
                return false;
            }

            that._fileOpen(fileEntry);
        });
    };

    this.onSaveFile = function (idx) {

        if (typeof idx === typeof undefined) {
            return false;
        }

        var that      = this;
        var fileEntry = this.getEditorFileEntry(idx);

        var promise = (typeof fileEntry === typeof undefined)
            ? this._fileSaveAs(this.getTabNavFilename(idx), this.getEditorContent(idx))
            : this._fileSave(fileEntry, this.getEditorContent(idx));

        promise.then(function (e) {
            if (typeof e !== typeof undefined) {
                that._markNavTabClean(idx);
                that._closeTabModals(idx);
            }
        });
    };

    this.onToggleReadOnly = function (idx) {

        var that = this;
        if (typeof idx === typeof undefined) {
            $.each(this.getAllEditorObjects(), function (i, v) {
                that.onToggleReadOnly(v.idx);
            });
        }

        var ace = this.getEditor(idx);

        if (typeof ace !== typeof undefined) {
            var isReadOnly = !ace.getOption('readOnly');

            ace.setOption('readOnly', isReadOnly);

            if (isReadOnly) {
                this.getTabContentElement(idx).find('.action-toggle-readonly .fa').removeClass('fa-unlock').addClass('fa-lock');
            }
            else {
                this.getTabContentElement(idx).find('.action-toggle-readonly .fa').removeClass('fa-lock').addClass('fa-unlock');
            }
        }
    };
};